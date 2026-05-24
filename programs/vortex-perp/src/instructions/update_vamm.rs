use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::constants::{MAX_RESERVE_DEVIATION_BPS, SCALE, VAMM_STATE_SEED};
use crate::errors::PerpError;
use crate::math::mark_price;
use crate::oracle::read_pyth_price;
use crate::state::VammState;

#[derive(Accounts)]
pub struct UpdateVamm<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [VAMM_STATE_SEED],
        bump = vamm_state.bump,
        constraint = vamm_state.authority == authority.key() @ PerpError::Unauthorized
    )]
    pub vamm_state: Account<'info, VammState>,
    pub price_update: Account<'info, PriceUpdateV2>,
}

pub fn handler(
    ctx: Context<UpdateVamm>,
    new_base_reserve: u128,
    new_quote_reserve: u128,
) -> Result<()> {
    require!(new_base_reserve > 0, PerpError::InvalidAmount);
    require!(new_quote_reserve > 0, PerpError::InvalidAmount);
    require!(
        ctx.accounts.vamm_state.open_interest == 0,
        PerpError::Unauthorized
    );
    new_base_reserve
        .checked_mul(new_quote_reserve)
        .ok_or(PerpError::MathOverflow)?;
    let index_price = read_pyth_price(
        &ctx.accounts.price_update,
        &ctx.accounts.vamm_state.pyth_feed_id,
    )?;
    let new_mark = mark_price(new_base_reserve, new_quote_reserve)?;
    let diff = if new_mark > index_price {
        new_mark
            .checked_sub(index_price)
            .ok_or(PerpError::MathOverflow)?
    } else {
        index_price
            .checked_sub(new_mark)
            .ok_or(PerpError::MathOverflow)?
    };
    let deviation_bps = diff
        .checked_mul(10_000)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(index_price)
        .ok_or(PerpError::MathOverflow)?;
    require!(
        deviation_bps <= MAX_RESERVE_DEVIATION_BPS,
        PerpError::ReservePriceDeviation
    );
    let _ = SCALE;

    let vamm = &mut ctx.accounts.vamm_state;
    vamm.base_asset_reserve = new_base_reserve;
    vamm.quote_asset_reserve = new_quote_reserve;
    vamm.k = new_base_reserve
        .checked_mul(new_quote_reserve)
        .ok_or(PerpError::MathOverflow)?;
    vamm.mark_price = new_mark;
    Ok(())
}
