use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, VerificationLevel};

use crate::constants::{MAX_ORACLE_AGE_SECS, MAX_ORACLE_CONFIDENCE_BPS};
use crate::errors::PerpError;

pub fn read_pyth_price(price_update: &Account<PriceUpdateV2>, feed_id: &[u8; 32]) -> Result<u128> {
    let price = price_update
        .get_price_no_older_than_with_custom_verification_level(
            &Clock::get()?,
            MAX_ORACLE_AGE_SECS,
            feed_id,
            VerificationLevel::Partial { num_signatures: 5 },
        )
        .map_err(|_| PerpError::StalePythPrice)?;

    require!(price.price > 0, PerpError::InvalidOraclePrice);
    let price_abs = price.price.unsigned_abs();
    let max_conf = price_abs
        .checked_mul(MAX_ORACLE_CONFIDENCE_BPS)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(PerpError::MathOverflow)?;
    require!(price.conf <= max_conf, PerpError::PythConfidenceTooWide);

    normalize_pyth_price(price.price, price.exponent)
}

fn normalize_pyth_price(price: i64, expo: i32) -> Result<u128> {
    require!(price > 0, PerpError::InvalidOraclePrice);
    let target_expo: i32 = -6;
    let diff = expo
        .checked_sub(target_expo)
        .ok_or(PerpError::MathOverflow)?;
    let factor = 10u128
        .checked_pow(diff.unsigned_abs())
        .ok_or(PerpError::MathOverflow)?;
    let price_u = price.unsigned_abs() as u128;

    let normalized = if diff < 0 {
        price_u.checked_div(factor).ok_or(PerpError::MathOverflow)?
    } else {
        price_u.checked_mul(factor).ok_or(PerpError::MathOverflow)?
    };

    require!(normalized > 0, PerpError::InvalidOraclePrice);
    Ok(normalized)
}
