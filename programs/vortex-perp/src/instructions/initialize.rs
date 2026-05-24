use anchor_lang::prelude::*;

use crate::constants::{
    COLLATERAL_VAULT_SEED, FUNDING_PERIOD, INSURANCE_FUND_SEED, MAINTENANCE_MARGIN, MAX_LEVERAGE,
    SCALE, SOL_USD_FEED_ID, TRADING_FEE_BPS, VAMM_STATE_SEED,
};
use crate::errors::PerpError;
use crate::math::mark_price;
use crate::state::{InsuranceFund, VammState};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + VammState::LEN,
        seeds = [VAMM_STATE_SEED],
        bump
    )]
    pub vamm_state: Account<'info, VammState>,
    #[account(
        init,
        payer = authority,
        space = 0,
        seeds = [COLLATERAL_VAULT_SEED],
        bump
    )]
    /// CHECK: zero-data program-owned SOL vault PDA
    pub collateral_vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + InsuranceFund::LEN,
        seeds = [INSURANCE_FUND_SEED],
        bump
    )]
    pub insurance_fund: Account<'info, InsuranceFund>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Initialize>,
    base_asset_reserve: u128,
    quote_asset_reserve: u128,
    pyth_feed_id: [u8; 32],
) -> Result<()> {
    require!(base_asset_reserve > 0, PerpError::InvalidAmount);
    require!(quote_asset_reserve > 0, PerpError::InvalidAmount);
    require!(pyth_feed_id != [0; 32], PerpError::InvalidFeedId);
    base_asset_reserve
        .checked_mul(quote_asset_reserve)
        .ok_or(PerpError::MathOverflow)?;

    let now = Clock::get()?.unix_timestamp;
    let vamm = &mut ctx.accounts.vamm_state;
    vamm.authority = ctx.accounts.authority.key();
    vamm.base_asset_reserve = base_asset_reserve;
    vamm.quote_asset_reserve = quote_asset_reserve;
    vamm.k = base_asset_reserve
        .checked_mul(quote_asset_reserve)
        .ok_or(PerpError::MathOverflow)?;
    vamm.mark_price = mark_price(base_asset_reserve, quote_asset_reserve)?;
    vamm.mark_price_twap = vamm.mark_price;
    vamm.twap_samples = [vamm.mark_price; 8];
    vamm.twap_sample_index = 0;
    vamm.twap_sample_count = 1;
    vamm.last_funding_ts = now;
    vamm.cumulative_funding_rate = 0;
    vamm.funding_rate_cap = 100;
    vamm.total_long_base = 0;
    vamm.total_short_base = 0;
    vamm.total_margin = 0;
    vamm.funding_pool = 0;
    vamm.fee_pool = 0;
    vamm.open_interest = 0;
    vamm.collateral_vault = ctx.accounts.collateral_vault.key();
    vamm.insurance_fund = ctx.accounts.insurance_fund.key();
    vamm.pyth_feed_id = if pyth_feed_id == SOL_USD_FEED_ID {
        pyth_feed_id
    } else {
        pyth_feed_id
    };
    vamm.max_leverage = MAX_LEVERAGE;
    vamm.maintenance_margin_bps = (MAINTENANCE_MARGIN * 10_000 / SCALE) as u16;
    vamm.trading_fee_bps = TRADING_FEE_BPS as u16;
    vamm.paused = false;
    vamm.bump = ctx.bumps.vamm_state;

    let fund = &mut ctx.accounts.insurance_fund;
    fund.authority = ctx.accounts.authority.key();
    fund.balance = 0;
    fund.total_payouts = 0;
    fund.bump = ctx.bumps.insurance_fund;
    let _ = FUNDING_PERIOD;

    Ok(())
}
