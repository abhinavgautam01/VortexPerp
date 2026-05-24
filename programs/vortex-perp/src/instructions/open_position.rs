use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::constants::{
    COLLATERAL_VAULT_SEED, MIN_MARGIN_LAMPORTS, POSITION_SEED, VAMM_STATE_SEED,
};
use crate::errors::PerpError;
use crate::events::PositionOpened;
use crate::math::{mark_price, open_position_result, trading_fee_lamports};
use crate::oracle::read_pyth_price;
use crate::sol::transfer_user_to_vault;
use crate::state::{Direction, Position, VammState};

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(mut, seeds = [VAMM_STATE_SEED], bump = vamm_state.bump)]
    pub vamm_state: Account<'info, VammState>,
    #[account(
        init,
        payer = trader,
        space = 8 + Position::LEN,
        seeds = [POSITION_SEED, trader.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    #[account(
        mut,
        seeds = [COLLATERAL_VAULT_SEED],
        bump,
        address = vamm_state.collateral_vault
    )]
    /// CHECK: program-owned SOL vault PDA
    pub collateral_vault: UncheckedAccount<'info>,
    pub price_update: Account<'info, PriceUpdateV2>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<OpenPosition>,
    direction: Direction,
    margin_lamports: u64,
    leverage: u8,
) -> Result<()> {
    let vamm = &mut ctx.accounts.vamm_state;
    require!(!vamm.paused, PerpError::VammPaused);
    require!(
        margin_lamports >= MIN_MARGIN_LAMPORTS,
        PerpError::MarginTooSmall
    );
    require!(
        leverage >= 1 && leverage <= vamm.max_leverage,
        PerpError::InvalidLeverage
    );

    let index_price = read_pyth_price(&ctx.accounts.price_update, &vamm.pyth_feed_id)?;
    let result = open_position_result(vamm, direction, margin_lamports, leverage, index_price)?;
    let notional_lamports = (margin_lamports as u128)
        .checked_mul(leverage as u128)
        .ok_or(PerpError::MathOverflow)?;
    let fee_lamports = trading_fee_lamports(notional_lamports)?;
    let deposit_lamports = margin_lamports
        .checked_add(fee_lamports)
        .ok_or(PerpError::InsufficientBalanceForFee)?;

    transfer_user_to_vault(
        &ctx.accounts.trader,
        &ctx.accounts.collateral_vault,
        &ctx.accounts.system_program,
        deposit_lamports,
    )?;

    vamm.base_asset_reserve = result.new_base_reserve;
    vamm.quote_asset_reserve = result.new_quote_reserve;
    vamm.mark_price = mark_price(vamm.base_asset_reserve, vamm.quote_asset_reserve)?;
    match direction {
        Direction::Long => {
            vamm.total_long_base = vamm
                .total_long_base
                .checked_add(result.size)
                .ok_or(PerpError::MathOverflow)?;
        }
        Direction::Short => {
            vamm.total_short_base = vamm
                .total_short_base
                .checked_add(result.size)
                .ok_or(PerpError::MathOverflow)?;
        }
    }
    vamm.total_margin = vamm
        .total_margin
        .checked_add(margin_lamports)
        .ok_or(PerpError::MathOverflow)?;
    vamm.open_interest = vamm
        .open_interest
        .checked_add(result.notional)
        .ok_or(PerpError::MathOverflow)?;
    vamm.fee_pool = vamm
        .fee_pool
        .checked_add(fee_lamports)
        .ok_or(PerpError::MathOverflow)?;

    let now = Clock::get()?.unix_timestamp;
    let position = &mut ctx.accounts.position;
    position.trader = ctx.accounts.trader.key();
    position.vamm = vamm.key();
    position.size = result.size;
    position.notional = result.notional;
    position.direction = direction;
    position.entry_price = result.entry_price;
    position.liquidation_price = result.liquidation_price;
    position.margin = margin_lamports;
    position.last_funding_ts = now;
    position.last_cumulative_funding_rate = vamm.cumulative_funding_rate;
    position.leverage = leverage;
    position.opened_at = now;
    position.bump = ctx.bumps.position;

    emit!(PositionOpened {
        trader: ctx.accounts.trader.key(),
        direction,
        size: result.size,
        entry_price: result.entry_price,
        margin: margin_lamports,
        leverage,
        liquidation_price: result.liquidation_price,
        timestamp: now,
    });

    Ok(())
}
