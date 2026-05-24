use anchor_lang::prelude::*;

#[account]
pub struct VammState {
    pub authority: Pubkey,
    pub base_asset_reserve: u128,
    pub quote_asset_reserve: u128,
    pub k: u128,
    pub mark_price: u128,
    pub mark_price_twap: u128,
    pub twap_samples: [u128; 8],
    pub twap_sample_index: u8,
    pub twap_sample_count: u8,
    pub last_funding_ts: i64,
    pub cumulative_funding_rate: i128,
    pub funding_rate_cap: u128,
    pub total_long_base: u128,
    pub total_short_base: u128,
    pub total_margin: u64,
    pub funding_pool: u64,
    pub fee_pool: u64,
    pub open_interest: u128,
    pub collateral_vault: Pubkey,
    pub insurance_fund: Pubkey,
    pub pyth_feed_id: [u8; 32],
    pub max_leverage: u8,
    pub maintenance_margin_bps: u16,
    pub trading_fee_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

impl VammState {
    pub const LEN: usize = 32
        + (16 * 5)
        + (16 * 8)
        + 1
        + 1
        + 8
        + 16
        + 16
        + 16
        + 16
        + 8
        + 8
        + 8
        + 16
        + 32
        + 32
        + 32
        + 1
        + 2
        + 2
        + 1
        + 1;
}

#[account]
pub struct Position {
    pub trader: Pubkey,
    pub vamm: Pubkey,
    pub size: u128,
    pub notional: u128,
    pub direction: Direction,
    pub entry_price: u128,
    pub liquidation_price: u128,
    pub margin: u64,
    pub last_funding_ts: i64,
    pub last_cumulative_funding_rate: i128,
    pub leverage: u8,
    pub opened_at: i64,
    pub bump: u8,
}

impl Position {
    pub const LEN: usize = 32 + 32 + 16 + 16 + 1 + 16 + 16 + 8 + 8 + 16 + 1 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Long,
    Short,
}

#[account]
pub struct InsuranceFund {
    pub authority: Pubkey,
    pub balance: u64,
    pub total_payouts: u64,
    pub bump: u8,
}

impl InsuranceFund {
    pub const LEN: usize = 32 + 8 + 8 + 1;
}
