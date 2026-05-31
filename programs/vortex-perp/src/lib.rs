pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod oracle;
pub mod sol;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use errors::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("72RTphkGMwRaxtmkBnyQ32NKox394craNKJcVABdKNo7");

#[program]
pub mod vortex_perp {
    use super::*;

    // TODO: Real Funding Rates: Implementing the mathematical crank to actually charge users funding rates every hour to keep the Mark Price pegged to the Index Price.
    // TODO: Multiple Markets: Expanding from just SOL-PERP to BTC-PERP and ETH-PERP.

    pub fn initialize(
        ctx: Context<Initialize>,
        base_asset_reserve: u128,
        quote_asset_reserve: u128,
        pyth_feed_id: [u8; 32],
    ) -> Result<()> {
        instructions::initialize::handler(
            ctx,
            base_asset_reserve,
            quote_asset_reserve,
            pyth_feed_id,
        )
    }

    pub fn open_position(
        ctx: Context<OpenPosition>,
        direction: Direction,
        margin_lamports: u64,
        leverage: u8,
    ) -> Result<()> {
        instructions::open_position::handler(ctx, direction, margin_lamports, leverage)
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        instructions::close_position::handler(ctx)
    }

    pub fn add_margin(ctx: Context<AddMargin>, lamports: u64) -> Result<()> {
        instructions::add_margin::handler(ctx, lamports)
    }

    pub fn settle_funding(ctx: Context<SettleFunding>) -> Result<()> {
        instructions::settle_funding::handler(ctx)
    }

    pub fn liquidate(ctx: Context<Liquidate>, trader: Pubkey) -> Result<()> {
        instructions::liquidate::handler(ctx, trader)
    }

    pub fn update_vamm(
        ctx: Context<UpdateVamm>,
        new_base_reserve: u128,
        new_quote_reserve: u128,
    ) -> Result<()> {
        instructions::update_vamm::handler(ctx, new_base_reserve, new_quote_reserve)
    }

    pub fn toggle_pause(ctx: Context<TogglePause>) -> Result<()> {
        instructions::toggle_pause::handler(ctx)
    }

    pub fn withdraw_fees(ctx: Context<WithdrawFees>, lamports: u64) -> Result<()> {
        instructions::withdraw_fees::handler(ctx, lamports)
    }
}
