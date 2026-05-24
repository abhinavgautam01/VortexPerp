use anchor_lang::prelude::*;

use crate::errors::PerpError;
use crate::math::{liquidation_price, signed_usd_to_lamports};
use crate::state::{Direction, Position, VammState};

pub fn apply_lazy_funding(
    vamm: &mut Account<VammState>,
    position: &mut Account<Position>,
    index_price: u128,
    now: i64,
) -> Result<()> {
    let funding_delta = vamm
        .cumulative_funding_rate
        .checked_sub(position.last_cumulative_funding_rate)
        .ok_or(PerpError::MathOverflow)?;
    if funding_delta == 0 {
        position.last_funding_ts = now;
        return Ok(());
    }

    let base_value_usd = (position.size as i128)
        .checked_mul(index_price as i128)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(crate::constants::SCALE as i128)
        .ok_or(PerpError::MathOverflow)?;
    let funding_payment_usd = base_value_usd
        .checked_mul(funding_delta)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(crate::constants::SCALE as i128)
        .ok_or(PerpError::MathOverflow)?;
    let funding_lamports = signed_usd_to_lamports(funding_payment_usd, index_price)?;
    let signed_margin_delta = match position.direction {
        Direction::Long => funding_lamports
            .checked_neg()
            .ok_or(PerpError::MathOverflow)?,
        Direction::Short => funding_lamports,
    };

    apply_funding_delta(vamm, position, signed_margin_delta)?;
    position.last_cumulative_funding_rate = vamm.cumulative_funding_rate;
    position.last_funding_ts = now;
    Ok(())
}

pub fn apply_funding_delta(
    vamm: &mut Account<VammState>,
    position: &mut Account<Position>,
    signed_margin_delta: i128,
) -> Result<()> {
    if signed_margin_delta == 0 {
        return Ok(());
    }
    if signed_margin_delta < 0 {
        let requested = u64::try_from(signed_margin_delta.unsigned_abs())
            .map_err(|_| PerpError::MathOverflow)?;
        let debit = requested.min(position.margin);
        position.margin = position
            .margin
            .checked_sub(debit)
            .ok_or(PerpError::MathOverflow)?;
        vamm.total_margin = vamm
            .total_margin
            .checked_sub(debit)
            .ok_or(PerpError::MathOverflow)?;
        vamm.funding_pool = vamm
            .funding_pool
            .checked_add(debit)
            .ok_or(PerpError::MathOverflow)?;
    } else {
        let requested = u64::try_from(signed_margin_delta).map_err(|_| PerpError::MathOverflow)?;
        let credit = requested.min(vamm.funding_pool);
        position.margin = position
            .margin
            .checked_add(credit)
            .ok_or(PerpError::MathOverflow)?;
        vamm.total_margin = vamm
            .total_margin
            .checked_add(credit)
            .ok_or(PerpError::MathOverflow)?;
        vamm.funding_pool = vamm
            .funding_pool
            .checked_sub(credit)
            .ok_or(PerpError::MathOverflow)?;
    }
    Ok(())
}

pub fn refresh_liquidation_price(
    position: &mut Account<Position>,
    index_price: u128,
) -> Result<()> {
    position.liquidation_price = liquidation_price(
        position.direction,
        position.entry_price,
        position.size,
        position.notional,
        position.margin,
        index_price,
    )?;
    Ok(())
}

pub fn checked_sub_position_totals(
    vamm: &mut Account<VammState>,
    position: &Position,
) -> Result<()> {
    match position.direction {
        Direction::Long => {
            vamm.total_long_base = vamm
                .total_long_base
                .checked_sub(position.size)
                .ok_or(PerpError::MathOverflow)?;
        }
        Direction::Short => {
            vamm.total_short_base = vamm
                .total_short_base
                .checked_sub(position.size)
                .ok_or(PerpError::MathOverflow)?;
        }
    }
    vamm.total_margin = vamm
        .total_margin
        .checked_sub(position.margin)
        .ok_or(PerpError::MathOverflow)?;
    vamm.open_interest = vamm
        .open_interest
        .checked_sub(position.notional)
        .ok_or(PerpError::MathOverflow)?;
    Ok(())
}
