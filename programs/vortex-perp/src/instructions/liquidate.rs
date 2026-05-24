use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::constants::{
    COLLATERAL_VAULT_SEED, INSURANCE_FUND_SEED, POSITION_SEED, VAMM_STATE_SEED,
};
use crate::errors::PerpError;
use crate::events::PositionLiquidated;
use crate::instructions::common::{apply_lazy_funding, checked_sub_position_totals};
use crate::math::{
    close_position_result, insurance_cut, liquidation_fee, margin_ratio, mark_price,
    signed_usd_to_lamports,
};
use crate::oracle::read_pyth_price;
use crate::sol::{credit_insurance_from_vault, debit_insurance_to_account, transfer_vault_to};
use crate::state::{InsuranceFund, Position, VammState};

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,
    #[account(mut)]
    /// CHECK: trader is only used as the close recipient and is constrained against position.trader.
    pub trader: UncheckedAccount<'info>,
    #[account(mut, seeds = [VAMM_STATE_SEED], bump = vamm_state.bump)]
    pub vamm_state: Account<'info, VammState>,
    #[account(
        mut,
        close = trader,
        seeds = [POSITION_SEED, trader.key().as_ref()],
        bump = position.bump,
        constraint = position.trader == trader.key() @ PerpError::Unauthorized,
        constraint = position.vamm == vamm_state.key() @ PerpError::Unauthorized
    )]
    pub position: Account<'info, Position>,
    #[account(mut, seeds = [COLLATERAL_VAULT_SEED], bump, address = vamm_state.collateral_vault)]
    /// CHECK: program-owned SOL vault PDA
    pub collateral_vault: UncheckedAccount<'info>,
    #[account(mut, seeds = [INSURANCE_FUND_SEED], bump = insurance_fund.bump, address = vamm_state.insurance_fund)]
    pub insurance_fund: Account<'info, InsuranceFund>,
    pub price_update: Account<'info, PriceUpdateV2>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Liquidate>, trader: Pubkey) -> Result<()> {
    require!(trader == ctx.accounts.trader.key(), PerpError::Unauthorized);
    require!(
        ctx.accounts.liquidator.key() != ctx.accounts.position.trader,
        PerpError::SelfLiquidation
    );
    let now = Clock::get()?.unix_timestamp;
    let index_price = read_pyth_price(
        &ctx.accounts.price_update,
        &ctx.accounts.vamm_state.pyth_feed_id,
    )?;
    apply_lazy_funding(
        &mut ctx.accounts.vamm_state,
        &mut ctx.accounts.position,
        index_price,
        now,
    )?;

    let close = close_position_result(&ctx.accounts.vamm_state, &ctx.accounts.position)?;
    let ratio = margin_ratio(&ctx.accounts.position, &close, index_price)?;
    let maintenance = (ctx.accounts.vamm_state.maintenance_margin_bps as u128)
        .checked_mul(crate::constants::SCALE)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(PerpError::MathOverflow)?;
    require!(ratio < maintenance, PerpError::NotLiquidatable);

    let pnl_lamports = signed_usd_to_lamports(close.pnl_usd, index_price)?;
    let remaining = (ctx.accounts.position.margin as i128)
        .checked_add(pnl_lamports)
        .ok_or(PerpError::MathOverflow)?;
    let mut paid_liquidation_fee = 0u64;

    if remaining > 0 {
        let remaining_u64 = u64::try_from(remaining).map_err(|_| PerpError::MathOverflow)?;
        let liq_fee = liquidation_fee(remaining_u64)?;
        let ins_cut = insurance_cut(remaining_u64)?;
        let trader_refund = remaining_u64
            .checked_sub(liq_fee)
            .and_then(|v| v.checked_sub(ins_cut))
            .ok_or(PerpError::MathOverflow)?;
        transfer_vault_to(
            &ctx.accounts.collateral_vault,
            &ctx.accounts.liquidator.to_account_info(),
            liq_fee,
        )?;
        credit_insurance_from_vault(
            &ctx.accounts.collateral_vault,
            &mut ctx.accounts.insurance_fund,
            ins_cut,
        )?;
        transfer_vault_to(
            &ctx.accounts.collateral_vault,
            &ctx.accounts.trader.to_account_info(),
            trader_refund,
        )?;
        paid_liquidation_fee = liq_fee;
    } else if remaining < 0 {
        let deficit =
            u64::try_from(remaining.unsigned_abs()).map_err(|_| PerpError::MathOverflow)?;
        let vault_info = ctx.accounts.collateral_vault.to_account_info();
        debit_insurance_to_account(&mut ctx.accounts.insurance_fund, &vault_info, deficit)?;
    }

    ctx.accounts.vamm_state.base_asset_reserve = close.new_base_reserve;
    ctx.accounts.vamm_state.quote_asset_reserve = close.new_quote_reserve;
    ctx.accounts.vamm_state.mark_price =
        mark_price(close.new_base_reserve, close.new_quote_reserve)?;
    checked_sub_position_totals(&mut ctx.accounts.vamm_state, &ctx.accounts.position)?;

    emit!(PositionLiquidated {
        trader,
        liquidator: ctx.accounts.liquidator.key(),
        direction: ctx.accounts.position.direction,
        size: ctx.accounts.position.size,
        margin: ctx.accounts.position.margin,
        remaining_lamports: remaining,
        liquidation_fee: paid_liquidation_fee,
        timestamp: now,
    });

    Ok(())
}
