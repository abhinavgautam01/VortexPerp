use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::constants::{FUNDING_PERIOD, SCALE, VAMM_STATE_SEED};
use crate::errors::PerpError;
use crate::events::FundingSettled;
use crate::math::mark_price;
use crate::oracle::read_pyth_price;
use crate::state::VammState;

#[derive(Accounts)]
pub struct SettleFunding<'info> {
    pub crank: Signer<'info>,
    #[account(mut, seeds = [VAMM_STATE_SEED], bump = vamm_state.bump)]
    pub vamm_state: Account<'info, VammState>,
    pub price_update: Account<'info, PriceUpdateV2>,
}

pub fn handler(ctx: Context<SettleFunding>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let vamm = &mut ctx.accounts.vamm_state;
    require!(
        now.checked_sub(vamm.last_funding_ts)
            .ok_or(PerpError::MathOverflow)?
            >= FUNDING_PERIOD,
        PerpError::FundingTooSoon
    );
    let index_price = read_pyth_price(&ctx.accounts.price_update, &vamm.pyth_feed_id)?;
    let current_mark = mark_price(vamm.base_asset_reserve, vamm.quote_asset_reserve)?;

    let sample_index = vamm.twap_sample_index as usize;
    vamm.twap_samples[sample_index] = current_mark;
    vamm.twap_sample_index = (vamm.twap_sample_index + 1) % 8;
    vamm.twap_sample_count = vamm.twap_sample_count.saturating_add(1).min(8);
    let mut sum = 0u128;
    for sample in vamm
        .twap_samples
        .iter()
        .take(vamm.twap_sample_count as usize)
    {
        sum = sum.checked_add(*sample).ok_or(PerpError::MathOverflow)?;
    }
    let twap = sum
        .checked_div(vamm.twap_sample_count as u128)
        .ok_or(PerpError::MathOverflow)?;

    let premium_num = (twap as i128)
        .checked_sub(index_price as i128)
        .ok_or(PerpError::MathOverflow)?
        .checked_mul(SCALE as i128)
        .ok_or(PerpError::MathOverflow)?;
    let premium = premium_num
        .checked_div(index_price as i128)
        .ok_or(PerpError::MathOverflow)?;
    let mut funding_rate = premium.checked_div(24).ok_or(PerpError::MathOverflow)?;
    let cap = i128::try_from(vamm.funding_rate_cap).map_err(|_| PerpError::MathOverflow)?;
    funding_rate = funding_rate.clamp(-cap, cap);

    vamm.cumulative_funding_rate = vamm
        .cumulative_funding_rate
        .checked_add(funding_rate)
        .ok_or(PerpError::MathOverflow)?;
    vamm.last_funding_ts = now;
    vamm.mark_price_twap = twap;
    vamm.mark_price = current_mark;

    emit!(FundingSettled {
        mark_price_twap: twap,
        index_price,
        funding_rate,
        cumulative_funding_rate: vamm.cumulative_funding_rate,
        timestamp: now,
    });

    Ok(())
}
