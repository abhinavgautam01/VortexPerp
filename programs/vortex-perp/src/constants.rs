use anchor_lang::prelude::*;

pub const SCALE: u128 = 1_000_000;
pub const LAMPORTS_PER_SOL_U128: u128 = 1_000_000_000;
pub const MIN_MARGIN_LAMPORTS: u64 = 10_000_000;
pub const FUNDING_PERIOD: i64 = 3_600;
pub const MAINTENANCE_MARGIN: u128 = 62_500;
pub const MAX_LEVERAGE: u8 = 10;
pub const TRADING_FEE_BPS: u64 = 10;
pub const LIQUIDATION_FEE_BPS: u64 = 250;
pub const INSURANCE_FEE_BPS: u64 = 50;
pub const MAX_ORACLE_CONFIDENCE_BPS: u64 = 100;
pub const MAX_ORACLE_AGE_SECS: u64 = 60;
pub const MAX_RESERVE_DEVIATION_BPS: u128 = 2_000;

pub const VAMM_STATE_SEED: &[u8] = b"vamm_state";
pub const POSITION_SEED: &[u8] = b"position";
pub const COLLATERAL_VAULT_SEED: &[u8] = b"collateral_vault";
pub const INSURANCE_FUND_SEED: &[u8] = b"insurance_fund";

pub const SOL_USD_FEED_ID: [u8; 32] = [
    0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda, 0x39,
    0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80, 0xb5, 0x6d,
];

pub fn now_ts() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}
