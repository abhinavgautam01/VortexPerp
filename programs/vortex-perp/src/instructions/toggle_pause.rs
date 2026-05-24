use anchor_lang::prelude::*;

use crate::constants::VAMM_STATE_SEED;
use crate::errors::PerpError;
use crate::state::VammState;

#[derive(Accounts)]
pub struct TogglePause<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [VAMM_STATE_SEED],
        bump = vamm_state.bump,
        constraint = vamm_state.authority == authority.key() @ PerpError::Unauthorized
    )]
    pub vamm_state: Account<'info, VammState>,
}

pub fn handler(ctx: Context<TogglePause>) -> Result<()> {
    ctx.accounts.vamm_state.paused = !ctx.accounts.vamm_state.paused;
    Ok(())
}
