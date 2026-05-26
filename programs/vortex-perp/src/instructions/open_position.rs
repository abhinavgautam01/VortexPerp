use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::constants::{
    COLLATERAL_VAULT_SEED, MIN_MARGIN_LAMPORTS, POSITION_SEED, VAMM_STATE_SEED,
};
use crate::errors::PerpError;
use crate::events::{PositionClosed, PositionOpened};
use crate::instructions::common::{apply_lazy_funding, refresh_liquidation_price};
use crate::math::{
    liquidation_price, mark_price, open_position_result, signed_usd_to_lamports,
    trading_fee_lamports, usd_to_lamports,
};
use crate::oracle::read_pyth_price;
use crate::sol::{transfer_user_to_vault, transfer_vault_to};
use crate::state::{Direction, Position, VammState};

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(mut, seeds = [VAMM_STATE_SEED], bump = vamm_state.bump)]
    pub vamm_state: Account<'info, VammState>,
    #[account(
        init_if_needed,
        payer = trader,
        space = 8 + Position::LEN,
        seeds = [POSITION_SEED, trader.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    #[account(
        mut,
        seeds = [COLLATERAL_VAULT_SEED],
        bump,
        address = vamm_state.collateral_vault
    )]
    /// CHECK: program-owned SOL vault PDA
    pub collateral_vault: UncheckedAccount<'info>,
    pub price_update: Account<'info, PriceUpdateV2>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<OpenPosition>,
    direction: Direction,
    margin_lamports: u64,
    leverage: u8,
) -> Result<()> {
    require!(!ctx.accounts.vamm_state.paused, PerpError::VammPaused);
    require!(
        margin_lamports >= MIN_MARGIN_LAMPORTS,
        PerpError::MarginTooSmall
    );
    require!(
        leverage >= 1 && leverage <= ctx.accounts.vamm_state.max_leverage,
        PerpError::InvalidLeverage
    );

    let now = Clock::get()?.unix_timestamp;
    let index_price = read_pyth_price(
        &ctx.accounts.price_update,
        &ctx.accounts.vamm_state.pyth_feed_id,
    )?;
    let is_new_position = ctx.accounts.position.trader == Pubkey::default();
    if !is_new_position {
        require!(
            ctx.accounts.position.trader == ctx.accounts.trader.key(),
            PerpError::Unauthorized
        );
        require!(
            ctx.accounts.position.vamm == ctx.accounts.vamm_state.key(),
            PerpError::Unauthorized
        );
        apply_lazy_funding(
            &mut ctx.accounts.vamm_state,
            &mut ctx.accounts.position,
            index_price,
            now,
        )?;
    }

    let result = open_position_result(
        &ctx.accounts.vamm_state,
        direction,
        margin_lamports,
        leverage,
        index_price,
    )?;
    let notional_lamports = (margin_lamports as u128)
        .checked_mul(leverage as u128)
        .ok_or(PerpError::MathOverflow)?;
    let fee_lamports = trading_fee_lamports(notional_lamports)?;

    if is_new_position {
        open_fresh_position(ctx, direction, margin_lamports, leverage, fee_lamports, result, now)
    } else if ctx.accounts.position.direction == direction {
        increase_position(ctx, margin_lamports, leverage, fee_lamports, result, index_price, now)
    } else {
        reduce_or_flip_position(ctx, direction, margin_lamports, leverage, fee_lamports, result, index_price, now)
    }
}

fn open_fresh_position(
    ctx: Context<OpenPosition>,
    direction: Direction,
    margin_lamports: u64,
    leverage: u8,
    fee_lamports: u64,
    result: crate::math::OpenResult,
    now: i64,
) -> Result<()> {
    let deposit_lamports = margin_lamports
        .checked_add(fee_lamports)
        .ok_or(PerpError::InsufficientBalanceForFee)?;
    transfer_user_to_vault(
        &ctx.accounts.trader,
        &ctx.accounts.collateral_vault,
        &ctx.accounts.system_program,
        deposit_lamports,
    )?;

    apply_open_to_vamm(&mut ctx.accounts.vamm_state, direction, result.size, result.notional, margin_lamports, fee_lamports, result.new_base_reserve, result.new_quote_reserve)?;

    let position = &mut ctx.accounts.position;
    position.trader = ctx.accounts.trader.key();
    position.vamm = ctx.accounts.vamm_state.key();
    position.size = result.size;
    position.notional = result.notional;
    position.direction = direction;
    position.entry_price = result.entry_price;
    position.liquidation_price = result.liquidation_price;
    position.margin = margin_lamports;
    position.last_funding_ts = now;
    position.last_cumulative_funding_rate = ctx.accounts.vamm_state.cumulative_funding_rate;
    position.leverage = leverage;
    position.opened_at = now;
    position.bump = ctx.bumps.position;

    emit_opened(&ctx, direction, result.size, result.entry_price, margin_lamports, leverage, result.liquidation_price, now);
    Ok(())
}

fn increase_position(
    ctx: Context<OpenPosition>,
    margin_lamports: u64,
    leverage: u8,
    fee_lamports: u64,
    result: crate::math::OpenResult,
    index_price: u128,
    now: i64,
) -> Result<()> {
    let deposit_lamports = margin_lamports
        .checked_add(fee_lamports)
        .ok_or(PerpError::InsufficientBalanceForFee)?;
    transfer_user_to_vault(
        &ctx.accounts.trader,
        &ctx.accounts.collateral_vault,
        &ctx.accounts.system_program,
        deposit_lamports,
    )?;

    let direction = ctx.accounts.position.direction;
    apply_open_to_vamm(&mut ctx.accounts.vamm_state, direction, result.size, result.notional, margin_lamports, fee_lamports, result.new_base_reserve, result.new_quote_reserve)?;

    let liquidation_price = {
        let position = &mut ctx.accounts.position;
        position.size = position
            .size
            .checked_add(result.size)
            .ok_or(PerpError::MathOverflow)?;
        position.notional = position
            .notional
            .checked_add(result.notional)
            .ok_or(PerpError::MathOverflow)?;
        position.margin = position
            .margin
            .checked_add(margin_lamports)
            .ok_or(PerpError::MathOverflow)?;
        position.entry_price = position
            .notional
            .checked_mul(crate::constants::SCALE)
            .ok_or(PerpError::MathOverflow)?
            .checked_div(position.size)
            .ok_or(PerpError::MathOverflow)?;
        refresh_liquidation_price(position, index_price)?;
        position.leverage = leverage;
        position.last_funding_ts = now;
        position.liquidation_price
    };

    emit_opened(&ctx, direction, result.size, result.entry_price, margin_lamports, leverage, liquidation_price, now);
    Ok(())
}

fn reduce_or_flip_position(
    mut ctx: Context<OpenPosition>,
    new_direction: Direction,
    margin_lamports: u64,
    leverage: u8,
    fee_lamports: u64,
    result: crate::math::OpenResult,
    index_price: u128,
    now: i64,
) -> Result<()> {
    let old_size = ctx.accounts.position.size;
    let close_size = result.size.min(old_size);
    let close_notional_basis = proportional_u128(ctx.accounts.position.notional, close_size, old_size)?;
    let margin_released = proportional_u64(ctx.accounts.position.margin, close_size, old_size)?;
    let close = close_position_slice(&ctx.accounts.vamm_state, &ctx.accounts.position, close_size, close_notional_basis)?;
    let pnl_lamports = signed_usd_to_lamports(close.pnl_usd, index_price)?;
    let exit_notional_lamports = usd_to_lamports(close.exit_notional, index_price)?;
    let closing_fee = trading_fee_lamports(exit_notional_lamports as u128)?;
    let collected_close_fee = settle_reduced_slice(
        &mut ctx,
        close_size,
        margin_released,
        pnl_lamports,
        closing_fee,
        now,
        close.exit_price,
    )?;

    if result.size < old_size {
        apply_reduction_to_position(&mut ctx, close_size, close_notional_basis, margin_released, close.new_base_reserve, close.new_quote_reserve, collected_close_fee, index_price)?;
        return Ok(());
    }

    subtract_existing_position_from_vamm(&mut ctx.accounts.vamm_state, &ctx.accounts.position)?;

    if result.size == old_size {
        ctx.accounts.vamm_state.base_asset_reserve = close.new_base_reserve;
        ctx.accounts.vamm_state.quote_asset_reserve = close.new_quote_reserve;
        ctx.accounts.vamm_state.mark_price = mark_price(close.new_base_reserve, close.new_quote_reserve)?;
        ctx.accounts.vamm_state.fee_pool = ctx
            .accounts
            .vamm_state
            .fee_pool
            .checked_add(collected_close_fee)
            .ok_or(PerpError::MathOverflow)?;
        ctx.accounts.position.close(ctx.accounts.trader.to_account_info())?;
        return Ok(());
    }

    let residual_size = result
        .size
        .checked_sub(old_size)
        .ok_or(PerpError::MathOverflow)?;
    let residual_notional = result
        .notional
        .checked_sub(close.exit_notional)
        .ok_or(PerpError::MathOverflow)?;
    require!(residual_size > 0 && residual_notional > 0, PerpError::InvalidAmount);
    let residual_margin = margin_lamports;
    let residual_fee = proportional_u64(fee_lamports, residual_notional, result.notional)?;
    let deposit_lamports = residual_margin
        .checked_add(residual_fee)
        .ok_or(PerpError::InsufficientBalanceForFee)?;
    transfer_user_to_vault(
        &ctx.accounts.trader,
        &ctx.accounts.collateral_vault,
        &ctx.accounts.system_program,
        deposit_lamports,
    )?;

    ctx.accounts.vamm_state.base_asset_reserve = result.new_base_reserve;
    ctx.accounts.vamm_state.quote_asset_reserve = result.new_quote_reserve;
    ctx.accounts.vamm_state.mark_price = mark_price(result.new_base_reserve, result.new_quote_reserve)?;
    add_position_totals(&mut ctx.accounts.vamm_state, new_direction, residual_size, residual_notional, residual_margin)?;
    ctx.accounts.vamm_state.fee_pool = ctx
        .accounts
        .vamm_state
        .fee_pool
        .checked_add(collected_close_fee)
        .ok_or(PerpError::MathOverflow)?
        .checked_add(residual_fee)
        .ok_or(PerpError::MathOverflow)?;

    let (entry_price, liquidation_price) = {
        let position = &mut ctx.accounts.position;
        position.direction = new_direction;
        position.size = residual_size;
        position.notional = residual_notional;
        position.margin = residual_margin;
        position.entry_price = residual_notional
            .checked_mul(crate::constants::SCALE)
            .ok_or(PerpError::MathOverflow)?
            .checked_div(residual_size)
            .ok_or(PerpError::MathOverflow)?;
        position.liquidation_price = liquidation_price(
            new_direction,
            position.entry_price,
            residual_size,
            residual_notional,
            residual_margin,
            index_price,
        )?;
        position.leverage = leverage;
        position.last_funding_ts = now;
        position.last_cumulative_funding_rate = ctx.accounts.vamm_state.cumulative_funding_rate;
        position.opened_at = now;
        (position.entry_price, position.liquidation_price)
    };

    emit_opened(&ctx, new_direction, residual_size, entry_price, residual_margin, leverage, liquidation_price, now);
    Ok(())
}

struct SliceCloseResult {
    exit_notional: u128,
    exit_price: u128,
    pnl_usd: i128,
    new_base_reserve: u128,
    new_quote_reserve: u128,
}

fn close_position_slice(
    vamm: &VammState,
    position: &Position,
    close_size: u128,
    close_notional_basis: u128,
) -> Result<SliceCloseResult> {
    require!(close_size > 0, PerpError::InvalidAmount);
    require!(close_size <= position.size, PerpError::InvalidAmount);

    match position.direction {
        Direction::Long => {
            let new_base_reserve = vamm
                .base_asset_reserve
                .checked_add(close_size)
                .ok_or(PerpError::MathOverflow)?;
            let new_quote_reserve = vamm
                .k
                .checked_div(new_base_reserve)
                .ok_or(PerpError::MathOverflow)?;
            require!(
                new_quote_reserve < vamm.quote_asset_reserve,
                PerpError::ReserveExhaustion
            );
            let quote_received = vamm
                .quote_asset_reserve
                .checked_sub(new_quote_reserve)
                .ok_or(PerpError::MathOverflow)?;
            let exit_price = quote_received
                .checked_mul(crate::constants::SCALE)
                .ok_or(PerpError::MathOverflow)?
                .checked_div(close_size)
                .ok_or(PerpError::MathOverflow)?;
            let pnl_usd = (quote_received as i128)
                .checked_sub(close_notional_basis as i128)
                .ok_or(PerpError::MathOverflow)?;
            Ok(SliceCloseResult {
                exit_notional: quote_received,
                exit_price,
                pnl_usd,
                new_base_reserve,
                new_quote_reserve,
            })
        }
        Direction::Short => {
            require!(
                close_size < vamm.base_asset_reserve,
                PerpError::ReserveExhaustion
            );
            let new_base_reserve = vamm
                .base_asset_reserve
                .checked_sub(close_size)
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
                .checked_mul(crate::constants::SCALE)
                .ok_or(PerpError::MathOverflow)?
                .checked_div(close_size)
                .ok_or(PerpError::MathOverflow)?;
            let pnl_usd = (close_notional_basis as i128)
                .checked_sub(quote_to_repay as i128)
                .ok_or(PerpError::MathOverflow)?;
            Ok(SliceCloseResult {
                exit_notional: quote_to_repay,
                exit_price,
                pnl_usd,
                new_base_reserve,
                new_quote_reserve,
            })
        }
    }
}

fn settle_reduced_slice(
    ctx: &mut Context<OpenPosition>,
    close_size: u128,
    margin_released: u64,
    pnl_lamports: i128,
    closing_fee: u64,
    now: i64,
    exit_price: u128,
) -> Result<u64> {
    let pre_fee_equity = (margin_released as i128)
        .checked_add(pnl_lamports)
        .ok_or(PerpError::MathOverflow)?;
    require!(pre_fee_equity > 0, PerpError::NegativeEquity);
    let collectible_fee = closing_fee.min(pre_fee_equity as u64);
    let payout = pre_fee_equity
        .checked_sub(collectible_fee as i128)
        .ok_or(PerpError::MathOverflow)?;
    if payout > 0 {
        let payout_u64 = u64::try_from(payout).map_err(|_| PerpError::MathOverflow)?;
        transfer_vault_to(
            &ctx.accounts.collateral_vault,
            &ctx.accounts.trader.to_account_info(),
            payout_u64,
        )?;
    }

    emit!(PositionClosed {
        trader: ctx.accounts.trader.key(),
        direction: ctx.accounts.position.direction,
        size: close_size,
        entry_price: ctx.accounts.position.entry_price,
        exit_price,
        pnl_lamports,
        margin_returned: if payout > 0 { payout as u64 } else { 0 },
        timestamp: now,
    });
    Ok(collectible_fee)
}

fn apply_reduction_to_position(
    ctx: &mut Context<OpenPosition>,
    close_size: u128,
    close_notional_basis: u128,
    margin_released: u64,
    new_base_reserve: u128,
    new_quote_reserve: u128,
    closing_fee: u64,
    index_price: u128,
) -> Result<()> {
    let direction = ctx.accounts.position.direction;
    match direction {
        Direction::Long => {
            ctx.accounts.vamm_state.total_long_base = ctx
                .accounts
                .vamm_state
                .total_long_base
                .checked_sub(close_size)
                .ok_or(PerpError::MathOverflow)?;
        }
        Direction::Short => {
            ctx.accounts.vamm_state.total_short_base = ctx
                .accounts
                .vamm_state
                .total_short_base
                .checked_sub(close_size)
                .ok_or(PerpError::MathOverflow)?;
        }
    }
    ctx.accounts.vamm_state.total_margin = ctx
        .accounts
        .vamm_state
        .total_margin
        .checked_sub(margin_released)
        .ok_or(PerpError::MathOverflow)?;
    ctx.accounts.vamm_state.open_interest = ctx
        .accounts
        .vamm_state
        .open_interest
        .checked_sub(close_notional_basis)
        .ok_or(PerpError::MathOverflow)?;
    ctx.accounts.vamm_state.fee_pool = ctx
        .accounts
        .vamm_state
        .fee_pool
        .checked_add(closing_fee)
        .ok_or(PerpError::MathOverflow)?;
    ctx.accounts.vamm_state.base_asset_reserve = new_base_reserve;
    ctx.accounts.vamm_state.quote_asset_reserve = new_quote_reserve;
    ctx.accounts.vamm_state.mark_price = mark_price(new_base_reserve, new_quote_reserve)?;

    let position = &mut ctx.accounts.position;
    position.size = position
        .size
        .checked_sub(close_size)
        .ok_or(PerpError::MathOverflow)?;
    position.notional = position
        .notional
        .checked_sub(close_notional_basis)
        .ok_or(PerpError::MathOverflow)?;
    position.margin = position
        .margin
        .checked_sub(margin_released)
        .ok_or(PerpError::MathOverflow)?;
    position.entry_price = position
        .notional
        .checked_mul(crate::constants::SCALE)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(position.size)
        .ok_or(PerpError::MathOverflow)?;
    refresh_liquidation_price(position, index_price)?;
    Ok(())
}

fn apply_open_to_vamm(
    vamm: &mut Account<VammState>,
    direction: Direction,
    size: u128,
    notional: u128,
    margin_lamports: u64,
    fee_lamports: u64,
    new_base_reserve: u128,
    new_quote_reserve: u128,
) -> Result<()> {
    vamm.base_asset_reserve = new_base_reserve;
    vamm.quote_asset_reserve = new_quote_reserve;
    vamm.mark_price = mark_price(new_base_reserve, new_quote_reserve)?;
    add_position_totals(vamm, direction, size, notional, margin_lamports)?;
    vamm.fee_pool = vamm
        .fee_pool
        .checked_add(fee_lamports)
        .ok_or(PerpError::MathOverflow)?;
    Ok(())
}

fn add_position_totals(
    vamm: &mut Account<VammState>,
    direction: Direction,
    size: u128,
    notional: u128,
    margin_lamports: u64,
) -> Result<()> {
    match direction {
        Direction::Long => {
            vamm.total_long_base = vamm
                .total_long_base
                .checked_add(size)
                .ok_or(PerpError::MathOverflow)?;
        }
        Direction::Short => {
            vamm.total_short_base = vamm
                .total_short_base
                .checked_add(size)
                .ok_or(PerpError::MathOverflow)?;
        }
    }
    vamm.total_margin = vamm
        .total_margin
        .checked_add(margin_lamports)
        .ok_or(PerpError::MathOverflow)?;
    vamm.open_interest = vamm
        .open_interest
        .checked_add(notional)
        .ok_or(PerpError::MathOverflow)?;
    Ok(())
}

fn subtract_existing_position_from_vamm(
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

fn proportional_u128(amount: u128, numerator: u128, denominator: u128) -> Result<u128> {
    amount
        .checked_mul(numerator)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(denominator)
        .ok_or(PerpError::MathOverflow.into())
}

fn proportional_u64(amount: u64, numerator: u128, denominator: u128) -> Result<u64> {
    let value = (amount as u128)
        .checked_mul(numerator)
        .ok_or(PerpError::MathOverflow)?
        .checked_div(denominator)
        .ok_or(PerpError::MathOverflow)?;
    u64::try_from(value).map_err(|_| PerpError::MathOverflow.into())
}

fn emit_opened(
    ctx: &Context<OpenPosition>,
    direction: Direction,
    size: u128,
    entry_price: u128,
    margin: u64,
    leverage: u8,
    liquidation_price: u128,
    timestamp: i64,
) {
    emit!(PositionOpened {
        trader: ctx.accounts.trader.key(),
        direction,
        size,
        entry_price,
        margin,
        leverage,
        liquidation_price,
        timestamp,
    });
}
