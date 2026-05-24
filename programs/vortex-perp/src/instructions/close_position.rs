use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::constants::{
    COLLATERAL_VAULT_SEED, INSURANCE_FUND_SEED, POSITION_SEED, VAMM_STATE_SEED,
};
use crate::errors::PerpError;
use crate::events::PositionClosed;
use crate::instructions::common::{apply_lazy_funding, checked_sub_position_totals};
use crate::math::{
    close_position_result, mark_price, signed_usd_to_lamports, trading_fee_lamports,
    usd_to_lamports,
};
use crate::oracle::read_pyth_price;
use crate::sol::{debit_insurance_to_account, transfer_vault_to};
use crate::state::{InsuranceFund, Position, VammState};

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
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

pub fn handler(ctx: Context<ClosePosition>) -> Result<()> {
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
    let pnl_lamports = signed_usd_to_lamports(close.pnl_usd, index_price)?;
    let exit_notional_lamports = usd_to_lamports(close.exit_notional, index_price)?;
    let closing_fee = trading_fee_lamports(exit_notional_lamports as u128)?;
    let pre_fee_equity = (ctx.accounts.position.margin as i128)
        .checked_add(pnl_lamports)
        .ok_or(PerpError::MathOverflow)?;
    let collectible_fee = if pre_fee_equity > 0 {
        closing_fee.min(pre_fee_equity as u64)
    } else {
        0
    };
    let payout = pre_fee_equity
        .checked_sub(collectible_fee as i128)
        .ok_or(PerpError::MathOverflow)?;

    let remaining_required = ctx
        .accounts
        .vamm_state
        .total_margin
        .checked_sub(ctx.accounts.position.margin)
        .ok_or(PerpError::MathOverflow)?
        .checked_add(ctx.accounts.vamm_state.funding_pool)
        .ok_or(PerpError::MathOverflow)?;
    if payout > 0 {
        let payout_u64 = u64::try_from(payout).map_err(|_| PerpError::MathOverflow)?;
        let needed = remaining_required
            .checked_add(payout_u64)
            .ok_or(PerpError::MathOverflow)?;
        let vault_lamports = **ctx
            .accounts
            .collateral_vault
            .to_account_info()
            .lamports
            .borrow();
        if vault_lamports < needed {
            let shortfall = needed
                .checked_sub(vault_lamports)
                .ok_or(PerpError::MathOverflow)?;
            let vault_info = ctx.accounts.collateral_vault.to_account_info();
            debit_insurance_to_account(&mut ctx.accounts.insurance_fund, &vault_info, shortfall)?;
        }
        transfer_vault_to(
            &ctx.accounts.collateral_vault,
            &ctx.accounts.trader.to_account_info(),
            payout_u64,
        )?;
    } else if payout < 0 {
        let deficit = u64::try_from(payout.unsigned_abs()).map_err(|_| PerpError::MathOverflow)?;
        let vault_info = ctx.accounts.collateral_vault.to_account_info();
        debit_insurance_to_account(&mut ctx.accounts.insurance_fund, &vault_info, deficit)?;
    }

    ctx.accounts.vamm_state.base_asset_reserve = close.new_base_reserve;
    ctx.accounts.vamm_state.quote_asset_reserve = close.new_quote_reserve;
    ctx.accounts.vamm_state.mark_price =
        mark_price(close.new_base_reserve, close.new_quote_reserve)?;
    ctx.accounts.vamm_state.fee_pool = ctx
        .accounts
        .vamm_state
        .fee_pool
        .checked_add(collectible_fee)
        .ok_or(PerpError::MathOverflow)?;
    checked_sub_position_totals(&mut ctx.accounts.vamm_state, &ctx.accounts.position)?;

    emit!(PositionClosed {
        trader: ctx.accounts.trader.key(),
        direction: ctx.accounts.position.direction,
        size: ctx.accounts.position.size,
        entry_price: ctx.accounts.position.entry_price,
        exit_price: close.exit_price,
        pnl_lamports,
        margin_returned: if payout > 0 { payout as u64 } else { 0 },
        timestamp: now,
    });

    Ok(())
}
