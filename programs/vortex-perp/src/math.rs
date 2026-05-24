use anchor_lang::prelude::*;

use crate::constants::{
    INSURANCE_FEE_BPS, LAMPORTS_PER_SOL_U128, LIQUIDATION_FEE_BPS, MAINTENANCE_MARGIN, SCALE,
    TRADING_FEE_BPS,
};
use crate::errors::PerpError;
use crate::state::{Direction, Position, VammState};

pub struct OpenResult {
    pub size: u128,
    pub notional: u128,
    pub entry_price: u128,
    pub liquidation_price: u128,
    pub new_base_reserve: u128,
    pub new_quote_reserve: u128,
}

pub struct CloseResult {
    pub exit_notional: u128,
    pub exit_price: u128,
    pub pnl_usd: i128,
    pub new_base_reserve: u128,
    pub new_quote_reserve: u128,
}

pub fn mark_price(base_reserve: u128, quote_reserve: u128) -> Result<u128> {
    require!(base_reserve > 0, PerpError::InvalidAmount);
    quote_reserve
        .checked_mul(SCALE)
        .ok_or(PerpError::MathOverflow.into())
        .and_then(|v| {
            v.checked_div(base_reserve)
                .ok_or(PerpError::MathOverflow.into())
        })
}

pub fn notional_usd_from_lamports(notional_lamports: u128, index_price: u128) -> Result<u128> {
    notional_lamports
        .checked_mul(index_price)
        .ok_or(PerpError::MathOverflow.into())
        .and_then(|v| {
            v.checked_div(LAMPORTS_PER_SOL_U128)
                .ok_or(PerpError::MathOverflow.into())
        })
}

pub fn usd_to_lamports(amount_usd: u128, index_price: u128) -> Result<u64> {
    require!(index_price > 0, PerpError::InvalidOraclePrice);
    let lamports = amount_usd
        .checked_mul(LAMPORTS_PER_SOL_U128)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(index_price)
        .ok_or(PerpError::MathOverflow)?;
    u64::try_from(lamports).map_err(|_| PerpError::MathOverflow.into())
}

pub fn signed_usd_to_lamports(amount_usd: i128, index_price: u128) -> Result<i128> {
    require!(index_price > 0, PerpError::InvalidOraclePrice);
    amount_usd
        .checked_mul(LAMPORTS_PER_SOL_U128 as i128)
        .ok_or(PerpError::MathOverflow.into())
        .and_then(|v| {
            v.checked_div(index_price as i128)
                .ok_or(PerpError::MathOverflow.into())
        })
}

pub fn trading_fee_lamports(notional_lamports: u128) -> Result<u64> {
    let fee = notional_lamports
        .checked_mul(TRADING_FEE_BPS as u128)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(PerpError::MathOverflow)?;
    u64::try_from(fee).map_err(|_| PerpError::MathOverflow.into())
}

pub fn open_position_result(
    vamm: &VammState,
    direction: Direction,
    margin_lamports: u64,
    leverage: u8,
    index_price: u128,
) -> Result<OpenResult> {
    let notional_lamports = (margin_lamports as u128)
        .checked_mul(leverage as u128)
        .ok_or(PerpError::MathOverflow)?;
    let notional = notional_usd_from_lamports(notional_lamports, index_price)?;
    require!(notional > 0, PerpError::InvalidAmount);

    match direction {
        Direction::Long => open_long(vamm, notional, margin_lamports, index_price),
        Direction::Short => open_short(vamm, notional, margin_lamports, index_price),
    }
}

fn open_long(
    vamm: &VammState,
    quote_amount: u128,
    margin_lamports: u64,
    index_price: u128,
) -> Result<OpenResult> {
    let new_quote_reserve = vamm
        .quote_asset_reserve
        .checked_add(quote_amount)
        .ok_or(PerpError::MathOverflow)?;
    let new_base_reserve = vamm
        .k
        .checked_div(new_quote_reserve)
        .ok_or(PerpError::MathOverflow)?;
    require!(
        new_base_reserve < vamm.base_asset_reserve,
        PerpError::ReserveExhaustion
    );
    let size = vamm
        .base_asset_reserve
        .checked_sub(new_base_reserve)
        .ok_or(PerpError::MathOverflow)?;
    require!(size > 0, PerpError::InvalidAmount);
    let entry_price = quote_amount
        .checked_mul(SCALE)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(size)
        .ok_or(PerpError::MathOverflow)?;
    let liquidation_price = liquidation_price(
        Direction::Long,
        entry_price,
        size,
        quote_amount,
        margin_lamports,
        index_price,
    )?;

    Ok(OpenResult {
        size,
        notional: quote_amount,
        entry_price,
        liquidation_price,
        new_base_reserve,
        new_quote_reserve,
    })
}

fn open_short(
    vamm: &VammState,
    quote_amount: u128,
    margin_lamports: u64,
    index_price: u128,
) -> Result<OpenResult> {
    require!(
        quote_amount < vamm.quote_asset_reserve,
        PerpError::ReserveExhaustion
    );
    let new_quote_reserve = vamm
        .quote_asset_reserve
        .checked_sub(quote_amount)
        .ok_or(PerpError::MathOverflow)?;
    require!(new_quote_reserve > 0, PerpError::ReserveExhaustion);
    let new_base_reserve = vamm
        .k
        .checked_div(new_quote_reserve)
        .ok_or(PerpError::MathOverflow)?;
    require!(
        new_base_reserve > vamm.base_asset_reserve,
        PerpError::InvalidAmount
    );
    let size = new_base_reserve
        .checked_sub(vamm.base_asset_reserve)
        .ok_or(PerpError::MathOverflow)?;
    let entry_price = quote_amount
        .checked_mul(SCALE)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(size)
        .ok_or(PerpError::MathOverflow)?;
    let liquidation_price = liquidation_price(
        Direction::Short,
        entry_price,
        size,
        quote_amount,
        margin_lamports,
        index_price,
    )?;

    Ok(OpenResult {
        size,
        notional: quote_amount,
        entry_price,
        liquidation_price,
        new_base_reserve,
        new_quote_reserve,
    })
}

pub fn close_position_result(vamm: &VammState, position: &Position) -> Result<CloseResult> {
    match position.direction {
        Direction::Long => close_long(vamm, position),
        Direction::Short => close_short(vamm, position),
    }
}

fn close_long(vamm: &VammState, position: &Position) -> Result<CloseResult> {
    let new_base_reserve = vamm
        .base_asset_reserve
        .checked_add(position.size)
        .ok_or(PerpError::MathOverflow)?;
    let k_over_base = vamm
        .k
        .checked_div(new_base_reserve)
        .ok_or(PerpError::MathOverflow)?;
    require!(
        k_over_base < vamm.quote_asset_reserve,
        PerpError::ReserveExhaustion
    );
    let quote_received = vamm
        .quote_asset_reserve
        .checked_sub(k_over_base)
        .ok_or(PerpError::MathOverflow)?;
    let exit_price = quote_received
        .checked_mul(SCALE)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(position.size)
        .ok_or(PerpError::MathOverflow)?;
    let pnl_usd = (quote_received as i128)
        .checked_sub(position.notional as i128)
        .ok_or(PerpError::MathOverflow)?;

    Ok(CloseResult {
        exit_notional: quote_received,
        exit_price,
        pnl_usd,
        new_base_reserve,
        new_quote_reserve: k_over_base,
    })
}

fn close_short(vamm: &VammState, position: &Position) -> Result<CloseResult> {
    require!(
        position.size < vamm.base_asset_reserve,
        PerpError::ReserveExhaustion
    );
    let new_base_reserve = vamm
        .base_asset_reserve
        .checked_sub(position.size)
        .ok_or(PerpError::MathOverflow)?;
    let new_quote_reserve = vamm
        .k
        .checked_div(new_base_reserve)
        .ok_or(PerpError::MathOverflow)?;
    require!(
        new_quote_reserve > vamm.quote_asset_reserve,
        PerpError::InvalidAmount
    );
    let quote_to_repay = new_quote_reserve
        .checked_sub(vamm.quote_asset_reserve)
        .ok_or(PerpError::MathOverflow)?;
    let exit_price = quote_to_repay
        .checked_mul(SCALE)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(position.size)
        .ok_or(PerpError::MathOverflow)?;
    let pnl_usd = (position.notional as i128)
        .checked_sub(quote_to_repay as i128)
        .ok_or(PerpError::MathOverflow)?;

    Ok(CloseResult {
        exit_notional: quote_to_repay,
        exit_price,
        pnl_usd,
        new_base_reserve,
        new_quote_reserve,
    })
}

pub fn liquidation_price(
    direction: Direction,
    entry_price: u128,
    size: u128,
    notional: u128,
    margin_lamports: u64,
    index_price: u128,
) -> Result<u128> {
    require!(size > 0, PerpError::InvalidAmount);
    let margin_usd = notional_usd_from_lamports(margin_lamports as u128, index_price)?;
    let maintenance_requirement = notional
        .checked_mul(MAINTENANCE_MARGIN)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(SCALE)
        .ok_or(PerpError::MathOverflow)?;
    require!(
        margin_usd > maintenance_requirement,
        PerpError::NegativeEquity
    );
    let buffer_usd = margin_usd
        .checked_sub(maintenance_requirement)
        .ok_or(PerpError::MathOverflow)?;
    let buffer_price = buffer_usd
        .checked_mul(SCALE)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(size)
        .ok_or(PerpError::MathOverflow)?;

    match direction {
        Direction::Long => Ok(entry_price.saturating_sub(buffer_price)),
        Direction::Short => entry_price
            .checked_add(buffer_price)
            .ok_or(PerpError::MathOverflow.into()),
    }
}

pub fn margin_ratio(
    position: &Position,
    close_result: &CloseResult,
    index_price: u128,
) -> Result<u128> {
    if position.notional == 0 {
        return Err(PerpError::InvalidAmount.into());
    }
    let margin_usd = notional_usd_from_lamports(position.margin as u128, index_price)? as i128;
    let equity = margin_usd
        .checked_add(close_result.pnl_usd)
        .ok_or(PerpError::MathOverflow)?;
    if equity <= 0 {
        return Ok(0);
    }
    (equity as u128)
        .checked_mul(SCALE)
        .ok_or(PerpError::MathOverflow.into())
        .and_then(|v| {
            v.checked_div(position.notional)
                .ok_or(PerpError::MathOverflow.into())
        })
}

pub fn liquidation_fee(remaining: u64) -> Result<u64> {
    bps_fee(remaining, LIQUIDATION_FEE_BPS)
}

pub fn insurance_cut(remaining: u64) -> Result<u64> {
    bps_fee(remaining, INSURANCE_FEE_BPS)
}

fn bps_fee(amount: u64, bps: u64) -> Result<u64> {
    amount
        .checked_mul(bps)
        .ok_or(PerpError::MathOverflow.into())
        .and_then(|v| v.checked_div(10_000).ok_or(PerpError::MathOverflow.into()))
}
