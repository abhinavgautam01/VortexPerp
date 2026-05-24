use anchor_lang::prelude::*;

use crate::state::Direction;

#[event]
pub struct PositionOpened {
    pub trader: Pubkey,
    pub direction: Direction,
    pub size: u128,
    pub entry_price: u128,
    pub margin: u64,
    pub leverage: u8,
    pub liquidation_price: u128,
    pub timestamp: i64,
}

#[event]
pub struct PositionClosed {
    pub trader: Pubkey,
    pub direction: Direction,
    pub size: u128,
    pub entry_price: u128,
    pub exit_price: u128,
    pub pnl_lamports: i128,
    pub margin_returned: u64,
    pub timestamp: i64,
}

#[event]
pub struct FundingSettled {
    pub mark_price_twap: u128,
    pub index_price: u128,
    pub funding_rate: i128,
    pub cumulative_funding_rate: i128,
    pub timestamp: i64,
}

#[event]
pub struct PositionLiquidated {
    pub trader: Pubkey,
    pub liquidator: Pubkey,
    pub direction: Direction,
    pub size: u128,
    pub margin: u64,
    pub remaining_lamports: i128,
    pub liquidation_fee: u64,
    pub timestamp: i64,
}
