use anchor_lang::prelude::*;

use crate::constants::{COLLATERAL_VAULT_SEED, VAMM_STATE_SEED};
use crate::errors::PerpError;
use crate::sol::transfer_vault_to;
use crate::state::VammState;

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [VAMM_STATE_SEED],
        bump = vamm_state.bump,
        constraint = vamm_state.authority == authority.key() @ PerpError::Unauthorized
    )]
    pub vamm_state: Account<'info, VammState>,
    #[account(mut, seeds = [COLLATERAL_VAULT_SEED], bump, address = vamm_state.collateral_vault)]
    /// CHECK: program-owned SOL vault PDA
    pub collateral_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<WithdrawFees>, lamports: u64) -> Result<()> {
    require!(
        lamports <= ctx.accounts.vamm_state.fee_pool,
        PerpError::InsufficientFeePool
    );
    let protected = ctx
        .accounts
        .vamm_state
        .total_margin
        .checked_add(ctx.accounts.vamm_state.funding_pool)
        .and_then(|v| v.checked_add(lamports))
        .ok_or(PerpError::MathOverflow)?;
    require!(
        **ctx
            .accounts
            .collateral_vault
            .to_account_info()
            .lamports
            .borrow()
            >= protected,
        PerpError::InsufficientCollateralVault
    );
    transfer_vault_to(
        &ctx.accounts.collateral_vault,
        &ctx.accounts.authority.to_account_info(),
        lamports,
    )?;
    ctx.accounts.vamm_state.fee_pool = ctx
        .accounts
        .vamm_state
        .fee_pool
        .checked_sub(lamports)
        .ok_or(PerpError::MathOverflow)?;
    Ok(())
}
