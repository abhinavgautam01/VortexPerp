use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::constants::{COLLATERAL_VAULT_SEED, POSITION_SEED, VAMM_STATE_SEED};
use crate::errors::PerpError;
use crate::instructions::common::{apply_lazy_funding, refresh_liquidation_price};
use crate::oracle::read_pyth_price;
use crate::sol::transfer_user_to_vault;
use crate::state::{Position, VammState};

#[derive(Accounts)]
pub struct AddMargin<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(mut, seeds = [VAMM_STATE_SEED], bump = vamm_state.bump)]
    pub vamm_state: Account<'info, VammState>,
    #[account(
        mut,
        seeds = [POSITION_SEED, trader.key().as_ref()],
        bump = position.bump,
        constraint = position.trader == trader.key() @ PerpError::Unauthorized,
        constraint = position.vamm == vamm_state.key() @ PerpError::Unauthorized
    )]
    pub position: Account<'info, Position>,
    #[account(mut, seeds = [COLLATERAL_VAULT_SEED], bump, address = vamm_state.collateral_vault)]
    /// CHECK: program-owned SOL vault PDA
    pub collateral_vault: UncheckedAccount<'info>,
    pub price_update: Account<'info, PriceUpdateV2>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AddMargin>, lamports: u64) -> Result<()> {
    require!(lamports > 0, PerpError::InvalidAmount);
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
    transfer_user_to_vault(
        &ctx.accounts.trader,
        &ctx.accounts.collateral_vault,
        &ctx.accounts.system_program,
        lamports,
    )?;
    ctx.accounts.position.margin = ctx
        .accounts
        .position
        .margin
        .checked_add(lamports)
        .ok_or(PerpError::MathOverflow)?;
    ctx.accounts.vamm_state.total_margin = ctx
        .accounts
        .vamm_state
        .total_margin
        .checked_add(lamports)
        .ok_or(PerpError::MathOverflow)?;
    refresh_liquidation_price(&mut ctx.accounts.position, index_price)?;
    Ok(())
}
