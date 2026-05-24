# SPEC.md — VortexPerp: Perpetual Futures Engine (vAMM) on Solana

> **VortexPerp — Capstone project for Solana Fellowship**
> Stack: Anchor 0.31.1 (Rust) · TypeScript (`@coral-xyz/anchor`) · Pyth Pull Oracle · Solana devnet
> Collateral: Native SOL · Market: SOL/USD (Pyth)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [System Architecture](#3-system-architecture)
4. [Core Concepts & Math](#4-core-concepts--math)
5. [On-chain Program — Account Structures](#5-on-chain-program--account-structures)
6. [On-chain Program — Instructions](#6-on-chain-program--instructions)
7. [Error Codes](#7-error-codes)
8. [Off-chain Components](#8-off-chain-components)
9. [Pyth Oracle Integration](#9-pyth-oracle-integration)
10. [Funding Rate Mechanism](#10-funding-rate-mechanism)
11. [Liquidation Engine](#11-liquidation-engine)
12. [Fee Structure](#12-fee-structure)
13. [Security Constraints](#13-security-constraints)
14. [Program Derived Addresses (PDAs)](#14-program-derived-addresses-pdas)
15. [Test Plan](#15-test-plan)
16. [Day-by-Day Build Plan](#16-day-by-day-build-plan)
17. [Deliverables & Demo Script](#17-deliverables--demo-script)
18. [Known Limitations & Future Work](#18-known-limitations--future-work)

---

## 1. Project Overview

A **minimal on-chain perpetual futures engine** built entirely on Solana using Anchor. Traders can open leveraged long or short positions on SOL/USD. Price discovery uses a **virtual AMM (vAMM)** — no order book, no liquidity providers. The vAMM's `x·y = k` invariant determines the mark price. An off-chain **crank bot** settles funding rates and triggers liquidations. The Pyth **pull oracle** provides the SOL/USD index price, with price updates posted on-chain as part of each transaction.

This is architecturally inspired by **Perpetual Protocol v1** but stripped to the essential core and adapted for Solana's account model.

### Key Properties

| Property | Value |
|---|---|
| Collateral | Native SOL |
| Market | SOL/USD |
| Oracle | Pyth Network pull oracle (devnet) |
| Leverage | 1x – 10x |
| Margin model | Isolated margin per position |
| Funding interval | Every 1 hour (3600 seconds) |
| Liquidation threshold | Margin ratio < 6.25% (= 1/16) |
| Maintenance margin | 6.25% |
| Initial margin | 10% (= max 10x leverage) |
| Trading fee | 0.1% of notional on open and close |
| Network | Solana devnet |

---

## 2. Goals & Non-Goals

### Goals (must ship)

- vAMM state account with `x·y=k` invariant
- Open long / short positions with leverage
- Close positions with PnL settlement in SOL
- SOL collateral vault (PDA-owned)
- Pyth oracle integration for index price
- Funding rate computation and lazy settlement
- On-chain liquidation instruction
- Off-chain crank bot (funding + liquidation)
- TypeScript SDK wrapping all instructions
- Minimal Next.js UI for demo

### Non-Goals (explicitly out of scope)

- Multiple markets / multi-collateral
- Cross-margin (one margin pool across all positions)
- Order book or limit orders
- Mainnet deployment
- DAO governance of parameters
- Token incentives / staking
- External matching engine, limit orders, or off-chain order routing
- Partial liquidations (always fully liquidate)

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        SOLANA DEVNET                         │
│                                                             │
│   ┌──────────────┐    ┌──────────────┐   ┌──────────────┐  │
│   │  VammState   │    │   Position   │   │ InsuranceFund│  │
│   │     PDA      │◄──►│     PDA      │   │     PDA      │  │
│   │  (1 global)  │    │(1 per trader)│   │  (1 global)  │  │
│   └──────┬───────┘    └──────┬───────┘   └──────────────┘  │
│          │                   │                              │
│   ┌──────▼───────┐    ┌──────▼───────┐                      │
│   │  Collateral  │    │  Pyth Price  │                      │
│   │  Vault PDA   │    │  Feed Acct   │                      │
│   │  (SOL held)  │    │  (SOL/USD)   │                      │
│   └──────────────┘    └──────────────┘                      │
└─────────────────────────────────────────────────────────────┘
          ▲                    ▲
          │                    │
┌─────────┴──────────┐  ┌──────┴─────────────────────────────┐
│   TypeScript SDK   │  │        Crank Bot (TypeScript)       │
│  open_position()   │  │  - polls every 60s                  │
│  close_position()  │  │  - settle_funding() every hour      │
│  add_margin()      │  │  - scan all positions for liq       │
└─────────┬──────────┘  └────────────────────────────────────┘
          │
┌─────────▼──────────┐
│    Next.js UI      │
│  - Connect wallet  │
│  - Open/close pos  │
│  - View mark price │
│  - View PnL        │
└────────────────────┘
```

---

## 4. Core Concepts & Math

> All on-chain values use **fixed-point integers** scaled by `1_000_000` (6 decimal places).
> Use `u128` for all intermediate multiplications to prevent overflow.
> All division must use `checked_div`. All multiplication must use `checked_mul`.
> Prices are stored as scaled quote-per-base values. If both reserves are scaled, price formulas
> must multiply by `SCALE` before dividing.
> PnL, equity, and funding deltas are signed values and must use `i128` until converted to
> lamports for transfer.

### 4.1 vAMM Invariant

```
x · y = k

where:
  x = base_asset_reserve   (virtual SOL)
  y = quote_asset_reserve  (virtual USD)
  k = constant (never changes unless admin adjusts)
```

Initial values (example for devnet):
```
base_asset_reserve  = 1_000_000 * SCALE   (1,000,000 virtual SOL)
quote_asset_reserve = 20_000_000 * SCALE  (20,000,000 virtual USD)
→ initial mark price = 20 USD/SOL
```

### 4.2 Mark Price

```
mark_price = quote_asset_reserve * SCALE / base_asset_reserve
```

### 4.3 Opening a Long Position

Trader inputs `quote_amount` (notional USD value they want exposure to).

```
base_out = base_reserve - k / (quote_reserve + quote_amount)

new_quote_reserve = quote_reserve + quote_amount
new_base_reserve  = base_reserve  - base_out

entry_price = quote_amount * SCALE / base_out
```

The trader's **position size** = `base_out` (virtual SOL units).

### 4.4 Opening a Short Position

Trader inputs SOL margin and leverage. The program converts this into a USD notional
(`quote_amount`) exactly like a long, then solves for the amount of base that must be added
to the vAMM so the trader receives that quote notional.

```
require quote_amount < quote_reserve

new_quote_reserve = quote_reserve - quote_amount
new_base_reserve  = k / new_quote_reserve
base_in           = new_base_reserve - base_reserve

entry_price = quote_amount * SCALE / base_in
```

The trader's **position size** = `base_in` (virtual SOL units).
The trader's **notional** = `quote_amount` (virtual USD units at entry).

### 4.5 Closing a Long Position

Reverse the long: return `position_size` base units to the pool, extract quote.

```
quote_received = quote_reserve - k / (base_reserve + position_size)

new_base_reserve  = base_reserve  + position_size
new_quote_reserve = quote_reserve - quote_received

exit_price = quote_received * SCALE / position_size
pnl_usd    = quote_received - notional_at_entry   (in scaled USD terms)
pnl_lamports = pnl_usd * LAMPORTS_PER_SOL / current_index_price
```

### 4.6 Closing a Short Position

Reverse the short: remove `position_size` base units from the pool, add quote back.

```
quote_to_repay = k / (base_reserve - position_size) - quote_reserve

new_base_reserve  = base_reserve  - position_size
new_quote_reserve = quote_reserve + quote_to_repay

exit_price = quote_to_repay * SCALE / position_size
pnl_usd    = notional_at_entry - quote_to_repay   (in scaled USD terms)
pnl_lamports = pnl_usd * LAMPORTS_PER_SOL / current_index_price
```

> **Note:** For shorts, the trader profits when the cost to "buy back" (`quote_to_repay`) is less than what they originally "sold" for (`notional_at_entry`).

### 4.7 Leverage

```
notional        = margin * leverage
margin_required = notional / leverage

// Trader deposits margin (SOL). Notional exposure = margin * leverage.
// This determines how much quote_amount hits the vAMM.
```

On-chain, leverage is only accepted as an integer `u8` in `[1, max_leverage]`. The program
must compute notional in lamports first, then convert to scaled USD with the oracle price:

```
notional_lamports = margin_lamports * leverage
notional_usd      = notional_lamports * index_price / LAMPORTS_PER_SOL
```

### 4.8 Liquidation Price

For the initial demo estimate, assuming no fees and margin exactly equals `notional / leverage`:
```
liquidation_price = entry_price * (1 - (1/leverage) + maintenance_margin_ratio)
                  = entry_price * (1 - 1/L + 0.0625)

liquidation_price = entry_price * (1 + (1/leverage) - maintenance_margin_ratio)
                  = entry_price * (1 + 1/L - 0.0625)
```

For on-chain storage, use the actual stored margin after deposits, margin additions, and funding:

```
margin_usd = margin_lamports * index_price / LAMPORTS_PER_SOL
maintenance_requirement = position.notional * maintenance_margin_ratio / SCALE
buffer_usd = margin_usd - maintenance_requirement

long_liquidation_price  = entry_price - buffer_usd * SCALE / position.size
short_liquidation_price = entry_price + buffer_usd * SCALE / position.size
```

Clamp long liquidation price to `0` if the buffer is larger than the entry-side loss. Store
`liquidation_price` as a crank/UI hint, but always recompute `margin_ratio` in `liquidate`.
If `buffer_usd <= 0`, reject the open/add-margin path unless the operation is part of a
liquidation or close; the position would already be below maintenance.

### 4.9 Margin Ratio

> **Units:** `margin` is in lamports (real SOL), while `notional` and `unrealised_pnl` are in scaled USD.
> To compute margin ratio, first convert margin to USD:

```
margin_usd     = margin_lamports * index_price / LAMPORTS_PER_SOL
unrealised_pnl = compute_pnl(position, current_mark_price)   // in scaled USD
equity_usd     = margin_usd + unrealised_pnl
margin_ratio   = equity_usd * SCALE / position.notional

Position is liquidatable when:
  margin_ratio < maintenance_margin_ratio (0.0625)
```

If `equity_usd <= 0`, treat the margin ratio as `0` and the position as liquidatable.
For liquidation validation, prefer exact close/unwind quote math over a linear mark-price
approximation when compute budget allows, so slippage is included in the health check.

### 4.10 Scaling Constants

```rust
pub const SCALE: u128         = 1_000_000;        // 6 decimal places
pub const LAMPORTS_PER_SOL_U128: u128 = 1_000_000_000;
pub const MIN_MARGIN_LAMPORTS: u64 = 10_000_000;  // 0.01 SOL
pub const FUNDING_PERIOD: i64 = 3600;             // 1 hour in seconds
pub const MAINTENANCE_MARGIN: u128 = 62_500;      // 0.0625 * SCALE
pub const MAX_LEVERAGE: u8    = 10;
pub const TRADING_FEE_BPS: u64 = 10;             // 0.1% = 10 bps
pub const LIQUIDATION_FEE_BPS: u64 = 250;        // 2.5% to liquidator
pub const INSURANCE_FEE_BPS: u64 = 50;           // 0.5% to insurance fund
pub const MAX_ORACLE_CONFIDENCE_BPS: u64 = 100;  // 1%
pub const MAX_ORACLE_AGE_SECS: u64 = 60;
```

When clamping signed funding rates, convert `funding_rate_cap` to `i128` with checked bounds
before applying `[-cap, +cap]`.

---

## 5. On-chain Program — Account Structures

### 5.1 `VammState`

**PDA seeds:** `["vamm_state"]`
**Size:** `8 + VammState::INIT_SPACE` (about 470 bytes with the fields below)

```rust
#[account]
pub struct VammState {
    // Authority
    pub authority: Pubkey,              // 32 — admin who can update params

    // vAMM reserves (scaled by SCALE)
    pub base_asset_reserve: u128,       // 16 — x (virtual SOL)
    pub quote_asset_reserve: u128,      // 16 — y (virtual USD)
    pub k: u128,                        // 16 — invariant (x*y), pre-computed

    // Price tracking
    pub mark_price: u128,               // 16 — current mark price (scaled)
    pub mark_price_twap: u128,          // 16 — recent mark TWAP used for funding
    pub twap_samples: [u128; 8],        // 128 — ring buffer of mark price samples
    pub twap_sample_index: u8,          // 1
    pub twap_sample_count: u8,          // 1 — number of samples collected (max 8)

    // Funding
    pub last_funding_ts: i64,           // 8 — unix timestamp of last funding
    pub cumulative_funding_rate: i128,  // 16 — sum of all funding rates (signed)
    pub funding_rate_cap: u128,         // 16 — max |funding_rate| per period (default: 100 = 0.01%)

    // Accounting
    pub total_long_base: u128,          // 16 — sum of all long position sizes
    pub total_short_base: u128,         // 16 — sum of all short position sizes
    pub total_margin: u64,              // 8 — active position margin in lamports
    pub funding_pool: u64,              // 8 — lamports collected from funding payers
    pub fee_pool: u64,                  // 8 — accumulated trading fees (lamports)
    pub open_interest: u128,            // 16 — total open notional (scaled USD)

    // References
    pub collateral_vault: Pubkey,       // 32 — PDA of SOL vault
    pub insurance_fund: Pubkey,         // 32 — PDA of insurance fund
    pub pyth_feed_id: [u8; 32],         // 32 — Pyth price feed ID (SOL/USD)

    // Config
    pub max_leverage: u8,               // 1
    pub maintenance_margin_bps: u16,    // 2 — 625 = 6.25%
    pub trading_fee_bps: u16,           // 2
    pub paused: bool,                   // 1 — emergency pause

    pub bump: u8,                       // 1
}
```

### 5.2 `Position`

**PDA seeds:** `["position", trader.key()]`
**Size:** `8 + Position::INIT_SPACE` (about 180 bytes with the fields below)

```rust
#[account]
pub struct Position {
    pub trader: Pubkey,                 // 32
    pub vamm: Pubkey,                   // 32

    // Position data
    pub size: u128,                     // 16 — base asset units (virtual SOL)
    pub notional: u128,                 // 16 — quote units (virtual USD) at entry
    pub direction: Direction,           // 1 — Long or Short

    // Prices (scaled by SCALE)
    pub entry_price: u128,              // 16
    pub liquidation_price: u128,        // 16

    // Collateral (in lamports — real SOL)
    pub margin: u64,                    // 8

    // Funding tracking
    pub last_funding_ts: i64,           // 8 — last per-position funding settlement timestamp
    pub last_cumulative_funding_rate: i128, // 16 — last cumulative rate settled for this position

    // Metadata
    pub leverage: u8,                   // 1
    pub opened_at: i64,                 // 8 — unix timestamp
    pub bump: u8,                       // 1
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum Direction {
    Long,
    Short,
}
```

### 5.3 `InsuranceFund`

**PDA seeds:** `["insurance_fund"]`
**Size:** `8 + InsuranceFund::INIT_SPACE` (about 57 bytes with the fields below)

```rust
#[account]
pub struct InsuranceFund {
    pub authority: Pubkey,      // 32
    pub balance: u64,           // 8 — lamports held
    pub total_payouts: u64,     // 8 — cumulative bad debt covered
    pub bump: u8,               // 1
}
```

`InsuranceFund.balance` must mirror the lamports held by the account excluding rent-exempt
reserve. Every payout from or deposit into the insurance fund updates both account lamports
and this tracked balance.

> **Space sizing:** Prefer `#[derive(InitSpace)]` and `space = 8 + Type::INIT_SPACE` over the
> rough byte estimates above. If manual sizing is used, include the 8-byte discriminator and
> Anchor enum discriminants.

---

## 6. On-chain Program — Instructions

### 6.1 `initialize`

Called once by the deployer. Sets up `VammState`, creates collateral vault and insurance fund PDAs.

```rust
pub fn initialize(
    ctx: Context<Initialize>,
    base_asset_reserve: u128,    // initial x
    quote_asset_reserve: u128,   // initial y
    pyth_feed_id: [u8; 32],      // Pyth SOL/USD feed ID
) -> Result<()>
```

**Accounts:**
```
authority         [signer, mut]
vamm_state        [init, PDA: "vamm_state"]
collateral_vault  [init, PDA: "collateral_vault"]  ← zero-data program-owned account, holds SOL
insurance_fund    [init, PDA: "insurance_fund"]
system_program
```

**Validation:**
- `base_asset_reserve > 0`
- `quote_asset_reserve > 0`
- `base_asset_reserve * quote_asset_reserve` does not overflow `u128`
- `authority` is signer
- `pyth_feed_id` is not all-zero bytes

**Effects:**
- Sets `k = base * quote`
- Sets `mark_price = quote * SCALE / base`
- Sets `last_funding_ts = Clock::get().unix_timestamp`
- Sets `max_leverage = 10`, `maintenance_margin_bps = 625`, `trading_fee_bps = 10`
- Sets `funding_rate_cap = 100` (0.01% max per hour)
- Stores `pyth_feed_id` for subsequent price lookups

---

### 6.2 `open_position`

Trader deposits SOL margin and opens a leveraged position.

```rust
pub fn open_position(
    ctx: Context<OpenPosition>,
    direction: Direction,
    margin_lamports: u64,    // SOL deposited (real lamports)
    leverage: u8,            // 1–10
) -> Result<()>
```

**Accounts:**
```
trader            [signer, mut]
vamm_state        [mut, PDA: "vamm_state"]
position          [init, PDA: "position", trader.key()]
collateral_vault  [mut, PDA: "collateral_vault"]
price_update      [read-only, Account<PriceUpdateV2>]  ← Pyth pull oracle
system_program
```

**Validation:**
- `leverage >= 1 && leverage <= vamm.max_leverage`
- `margin_lamports >= MIN_MARGIN` (e.g. 0.01 SOL = 10_000_000 lamports)
- `vamm.paused == false`
- Trader has no existing position (one position per trader per market)
- Pyth price matches `vamm.pyth_feed_id`, is positive, not stale, and passes confidence check
- Computed notional and vAMM output are non-zero after scaling
- For longs, `base_out < vamm.base_asset_reserve` so base reserve cannot be exhausted
- For shorts, `notional_usd < vamm.quote_asset_reserve` so quote reserve cannot be exhausted
- Trader has enough SOL to pay `margin_lamports + fee_lamports`

**Execution steps:**
1. Read `index_price` from Pyth `PriceUpdateV2` (with staleness + confidence check)
2. Compute `notional_lamports = margin_lamports * leverage`
3. Convert to USD: `notional_usd = notional_lamports * index_price / LAMPORTS_PER_SOL`
4. Run direction-specific vAMM math:
   - Long: treat `notional_usd` as quote added to the pool and compute `base_out`
   - Short: treat `notional_usd` as quote removed from the pool and compute `base_in`
5. Set `position.size` to `base_out` for longs or `base_in` for shorts
6. Compute `entry_price = notional_usd * SCALE / position.size`
7. Compute trading fee in lamports: `fee_lamports = notional_lamports * TRADING_FEE_BPS / 10000`
8. Verify `margin_lamports + fee_lamports` does not overflow
9. Compute `liquidation_price` from `margin_lamports`
10. Transfer `margin_lamports + fee_lamports` from trader → `collateral_vault` (via system_program CPI)
11. Store `position.margin = margin_lamports`
12. Store `position.last_cumulative_funding_rate = vamm.cumulative_funding_rate`
13. Store `position.last_funding_ts = Clock::get()?.unix_timestamp`
14. Add `fee_lamports` to `vamm.fee_pool`
15. Update `vamm.base_asset_reserve`, `quote_asset_reserve`
16. Update `vamm.mark_price = quote_asset_reserve * SCALE / base_asset_reserve`
17. Update `vamm.total_long_base` or `total_short_base`
18. Update `vamm.total_margin += margin_lamports`
19. Update `vamm.open_interest += notional_usd`
20. Write `Position` account

**Emits event:**
```rust
emit!(PositionOpened {
    trader: ctx.accounts.trader.key(),
    direction,
    size: position_size,
    entry_price,
    margin: margin_lamports,
    leverage,
    liquidation_price,
    timestamp: Clock::get()?.unix_timestamp,
});
```

---

### 6.3 `close_position`

Fully close an existing position. Settle PnL + funding. Return remaining margin to trader.

```rust
pub fn close_position(ctx: Context<ClosePosition>) -> Result<()>
```

**Accounts:**
```
trader            [signer, mut]  ← must be mut to receive rent + payout
vamm_state        [mut]
position          [mut, close → trader, PDA: "position", trader.key()]
collateral_vault  [mut]
insurance_fund    [mut]
price_update      [read-only, Account<PriceUpdateV2>]  ← Pyth pull oracle
system_program
```

**Validation:**
- `position.trader == trader.key()`
- Pyth price matches `vamm.pyth_feed_id`, is positive, not stale, and passes confidence check
- Reverse vAMM math does not underflow reserves or produce zero quote/base amounts
- After closing this position, collateral vault plus any insurance top-up can still cover all other active margin and `vamm.funding_pool`

**Execution steps:**
1. Apply lazy funding settlement for this position
2. Read `index_price` from Pyth `PriceUpdateV2`
3. Run reverse vAMM math:
   - For longs: compute `quote_received` by returning `position.size` base to pool
   - For shorts: compute `quote_to_repay` by removing `position.size` base from pool
4. Compute PnL in scaled USD:
   - Long: `pnl_usd = quote_received - position.notional`
   - Short: `pnl_usd = position.notional - quote_to_repay`
5. Convert PnL to lamports: `pnl_lamports = pnl_usd * LAMPORTS_PER_SOL / index_price`
6. Compute closing notional in lamports:
   - `exit_notional_usd = quote_received` for longs, `quote_to_repay` for shorts
   - `exit_notional_lamports = exit_notional_usd * LAMPORTS_PER_SOL / index_price`
7. Compute closing fee in lamports: `closing_fee = exit_notional_lamports * TRADING_FEE_BPS / 10000`
8. Compute `pre_fee_equity = position.margin + pnl_lamports`
9. Compute `collected_closing_fee = min(closing_fee, max(pre_fee_equity, 0))`
10. Compute signed `payout = pre_fee_equity - collected_closing_fee`
11. If `payout > 0`: transfer `payout` from vault → trader; if the vault would fall below other active margin plus `funding_pool`, transfer the shortfall from insurance fund first and update `insurance_fund.balance`/`total_payouts`
12. If `payout <= 0`: record `deficit = -payout`, use insurance fund to cover protocol bad debt if required, decrease `insurance_fund.balance`, increase `insurance_fund.total_payouts`, and transfer 0 to trader
13. Add `collected_closing_fee` to `vamm.fee_pool`
14. Restore vAMM reserves
15. Update `total_long_base` or `total_short_base`
16. Update `vamm.total_margin -= position.margin`
17. Update `vamm.open_interest -= position.notional`
18. Close `Position` account (rent goes to trader)

**Emits event:**
```rust
emit!(PositionClosed {
    trader: ctx.accounts.trader.key(),
    direction: position.direction,
    size: position.size,
    entry_price: position.entry_price,
    exit_price,
    pnl_lamports,
    margin_returned: payout.max(0) as u64,
    timestamp: Clock::get()?.unix_timestamp,
});
```

---

### 6.4 `add_margin`

Deposit additional SOL into an existing position to avoid liquidation.

```rust
pub fn add_margin(
    ctx: Context<AddMargin>,
    lamports: u64,
) -> Result<()>
```

**Accounts:**
```
trader            [signer, mut]
vamm_state        [mut]
position          [mut, PDA: "position", trader.key()]
collateral_vault  [mut]
price_update      [read-only, Account<PriceUpdateV2>]  ← needed to settle funding/recompute risk
system_program
```

**Validation:**
- `lamports > 0`
- `position.trader == trader.key()`
- Pyth price matches `vamm.pyth_feed_id`, is positive, not stale, and passes confidence check

**Execution steps:**
1. Settle pending funding for the position before changing margin
2. Transfer `lamports` from trader → vault
3. `position.margin += lamports`
4. `vamm.total_margin += lamports`
5. Recompute `liquidation_price` as a UI hint using the updated margin

> **Important:** `liquidation_price` is an optimization/hint for the crank scan. The on-chain
> `liquidate` instruction must always recompute the full margin ratio and must not rely only
> on the stored liquidation price.

---

### 6.5 `settle_funding`

Called by the crank bot every hour. Updates the cumulative funding rate. Applies lazy settlement — each position's funding is settled when the position is next touched.

```rust
pub fn settle_funding(ctx: Context<SettleFunding>) -> Result<()>
```

**Accounts:**
```
crank             [signer] ← any signer, permissionless
vamm_state        [mut]
price_update      [read-only, Account<PriceUpdateV2>]  ← Pyth pull oracle
```

**Validation:**
- `Clock::get().unix_timestamp - vamm.last_funding_ts >= FUNDING_PERIOD`
- Pyth price matches `vamm.pyth_feed_id`, is positive, not stale, and passes confidence check

**Execution steps:**
1. Read `index_price` from Pyth `PriceUpdateV2`
2. Compute current spot `mark_price = vamm.quote_asset_reserve * SCALE / vamm.base_asset_reserve`
3. Record `mark_price` into TWAP ring buffer: `vamm.twap_samples[vamm.twap_sample_index] = mark_price`
4. Advance ring buffer: `vamm.twap_sample_index = (vamm.twap_sample_index + 1) % 8`
5. Update `twap_sample_count = min(twap_sample_count + 1, 8)`
6. Compute `mark_price_twap = sum(twap_samples[0..twap_sample_count]) / twap_sample_count`
7. Compute signed `premium = (mark_price_twap - index_price) * SCALE / index_price`
8. Compute `funding_rate = premium / 24` (per-hour rate, signed scaled value)
9. Clamp: `funding_rate = clamp(funding_rate, -funding_rate_cap, +funding_rate_cap)`
10. `vamm.cumulative_funding_rate += funding_rate`
11. Update `vamm.last_funding_ts`
12. Update `vamm.mark_price_twap`

Note: Individual position funding is settled **lazily** when a position is touched by
`add_margin`, `close_position`, or `liquidate`. No per-position loop needed.

**Emits event:**
```rust
emit!(FundingSettled {
    mark_price_twap,
    index_price,
    funding_rate,
    cumulative_funding_rate: vamm.cumulative_funding_rate,
    timestamp: Clock::get()?.unix_timestamp,
});
```

**Lazy funding settlement formula (applied on add_margin/close/liquidate):**
```
funding_delta = cumulative_rate_now - position.last_cumulative_funding_rate
base_value_usd = position.size * index_price / SCALE
funding_payment_usd = base_value_usd * funding_delta / SCALE

Convert to lamports: funding_lamports = funding_payment_usd * LAMPORTS_PER_SOL / index_price

if funding_lamports > 0 and direction == Long:  debit margin, credit funding_pool
if funding_lamports > 0 and direction == Short: debit funding_pool, credit margin
if funding_lamports < 0 and direction == Long:  debit funding_pool, credit margin
if funding_lamports < 0 and direction == Short: debit margin, credit funding_pool

position.last_cumulative_funding_rate = cumulative_rate_now
position.last_funding_ts = current_timestamp
```

Funding is settled against `vamm.funding_pool` to avoid minting margin during lazy settlement.
When a position pays funding, the paid lamports move from `position.margin` into
`vamm.funding_pool`. When a position receives funding, the credited lamports come from
`vamm.funding_pool`. If the pool cannot fully pay a receiver, credit only the available
amount in this MVP and still advance `last_cumulative_funding_rate`; unpaid funding is not
carried forward.

---

### 6.6 `liquidate`

Called by the crank bot when a position's margin ratio falls below threshold.

```rust
pub fn liquidate(
    ctx: Context<Liquidate>,
    trader: Pubkey,
) -> Result<()>
```

**Accounts:**
```
liquidator        [signer, mut]  ← crank bot keypair, receives fee
trader            [mut] ← the underwater position owner (receives rent refund)
vamm_state        [mut]
position          [mut, close → trader, PDA: "position", trader.key()]
collateral_vault  [mut]
insurance_fund    [mut]
price_update      [read-only, Account<PriceUpdateV2>]  ← Pyth pull oracle
system_program
```

**Validation:**
- Fetch `index_price` from Pyth `PriceUpdateV2`
- Pyth price matches `vamm.pyth_feed_id`, is positive, not stale, and passes confidence check
- Require `liquidator.key() != position.trader` (no self-liquidation)
- Settle pending funding, then compute current `margin_ratio`:
  ```
  unrealised_pnl = compute_pnl(position, current_mark_price)  // in scaled USD
  margin_usd     = position.margin * index_price / LAMPORTS_PER_SOL  // convert lamports → USD
  equity_usd     = margin_usd + unrealised_pnl
  margin_ratio   = equity_usd <= 0 ? 0 : equity_usd * SCALE / position.notional
  ```
- Require `margin_ratio < vamm.maintenance_margin_bps * SCALE / 10_000`

**Execution steps:**
1. Settle pending funding for the position
2. Recompute margin ratio after funding and require it is below maintenance
3. Unwind position on vAMM (reverse math)
4. Compute signed `remaining = position.margin + pnl_lamports`
5. If `remaining > 0`:
   - `liquidation_fee = remaining * LIQUIDATION_FEE_BPS / 10000`
   - `insurance_cut = remaining * INSURANCE_FEE_BPS / 10000`
   - `trader_refund = remaining - liquidation_fee - insurance_cut`
   - Transfer `liquidation_fee` from vault → liquidator
   - Transfer `insurance_cut` from vault → insurance fund
   - Increase `insurance_fund.balance` by `insurance_cut`
   - Transfer `trader_refund` from vault → trader
6. If `remaining <= 0` (bad debt):
   - Pull `|remaining|` from insurance fund
   - Decrease `insurance_fund.balance` by the amount pulled
   - Increase `insurance_fund.total_payouts` by the amount pulled
   - Transfer `0` to liquidator
7. Restore vAMM reserves
8. Update `total_long_base` or `total_short_base`
9. Update `vamm.total_margin -= position.margin`
10. Update `vamm.open_interest -= position.notional`
11. Close `Position` account

**Emits event:**
```rust
emit!(PositionLiquidated {
    trader: position.trader,
    liquidator: ctx.accounts.liquidator.key(),
    direction: position.direction,
    size: position.size,
    margin: position.margin,
    remaining_lamports: remaining,
    liquidation_fee,
    timestamp: Clock::get()?.unix_timestamp,
});
```

---

### 6.7 `update_vamm` (admin only)

Emergency admin instruction to adjust `k` if the vAMM price drifts too far from oracle.

```rust
pub fn update_vamm(
    ctx: Context<UpdateVamm>,
    new_base_reserve: u128,
    new_quote_reserve: u128,
) -> Result<()>
```

**Accounts:**
```
authority   [signer] — must match vamm.authority
vamm_state  [mut]
price_update [read-only, Account<PriceUpdateV2>]
```

**Validation:**
- Only `vamm.authority` can call
- `vamm.open_interest == 0` (do not re-peg reserves while positions are open)
- New reserves are non-zero and `new_base_reserve * new_quote_reserve` does not overflow
- Pyth price matches `vamm.pyth_feed_id`, is positive, not stale, and passes confidence check
- New reserves maintain a sensible price (within 20% of oracle)

**Effects:**
- Sets reserves to the supplied values
- Sets `k = new_base_reserve * new_quote_reserve`
- Sets `mark_price = new_quote_reserve * SCALE / new_base_reserve`

---

### 6.8 `toggle_pause` (admin only)

```rust
pub fn toggle_pause(ctx: Context<TogglePause>) -> Result<()>
```

Sets `vamm.paused = !vamm.paused`. Blocks `open_position` when paused. Close and liquidate always remain active.

---

### 6.9 `withdraw_fees` (admin only)

Withdraw accumulated trading fees from the collateral vault.

```rust
pub fn withdraw_fees(
    ctx: Context<WithdrawFees>,
    lamports: u64,
) -> Result<()>
```

**Accounts:**
```
authority         [signer, mut]  — must match vamm.authority
vamm_state        [mut]
collateral_vault  [mut]
system_program
```

**Validation:**
- Only `vamm.authority` can call
- `lamports <= vamm.fee_pool`
- `collateral_vault.lamports >= vamm.total_margin + vamm.funding_pool + lamports` so active margin and pending funding reserves remain covered

**Execution steps:**
1. Transfer `lamports` from vault → authority
2. `vamm.fee_pool -= lamports`

---

## 7. Error Codes

```rust
#[error_code]
pub enum PerpError {
    #[msg("vAMM is currently paused")]
    VammPaused,

    #[msg("Leverage must be between 1 and max_leverage")]
    InvalidLeverage,

    #[msg("Margin too small")]
    MarginTooSmall,

    #[msg("Margin plus trading fee exceeds available balance")]
    InsufficientBalanceForFee,

    #[msg("Trader already has an open position")]
    PositionAlreadyOpen,

    #[msg("Position is not liquidatable")]
    NotLiquidatable,

    #[msg("Cannot self-liquidate")]
    SelfLiquidation,

    #[msg("Funding period not elapsed yet")]
    FundingTooSoon,

    #[msg("Pyth price is stale or invalid")]
    StalePythPrice,

    #[msg("Oracle price must be positive")]
    InvalidOraclePrice,

    #[msg("Pyth confidence too wide")]
    PythConfidenceTooWide,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Insufficient insurance fund balance")]
    InsufficientInsuranceFund,

    #[msg("Insufficient collateral vault balance")]
    InsufficientCollateralVault,

    #[msg("Invalid oracle account")]
    InvalidOracle,

    #[msg("Invalid Pyth feed ID")]
    InvalidFeedId,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Insufficient fee pool balance")]
    InsufficientFeePool,

    #[msg("New reserves deviate too far from oracle price")]
    ReservePriceDeviation,

    #[msg("Trade amount must be greater than zero")]
    InvalidAmount,

    #[msg("Trade would exhaust vAMM reserves")]
    ReserveExhaustion,

    #[msg("Position equity is zero or negative")]
    NegativeEquity,
}
```

---

## 8. Off-chain Components

### 8.1 TypeScript SDK (`/sdk/src/index.ts`)

```typescript
export class PerpSDK {
  constructor(
    connection: Connection,
    program: Program<VortexPerp>,
    wallet: Wallet
  )

  // Read state
  async getVammState(): Promise<VammState>
  async getPosition(trader: PublicKey): Promise<Position | null>
  async getMarkPrice(): Promise<number>
  async getIndexPrice(): Promise<number>  // from Pyth
  async computePnl(trader: PublicKey): Promise<number>
  async getMarginRatio(trader: PublicKey): Promise<number>

  // Transactions
  async openPosition(
    direction: 'long' | 'short',
    marginSol: number,
    leverage: number
  ): Promise<TransactionSignature>

  async closePosition(): Promise<TransactionSignature>

  async addMargin(solAmount: number): Promise<TransactionSignature>

  async settleFunding(): Promise<TransactionSignature>
  async liquidate(trader: PublicKey): Promise<TransactionSignature>

  // Admin transactions
  async togglePause(): Promise<TransactionSignature>
  async updateVamm(
    newBaseReserve: bigint,
    newQuoteReserve: bigint
  ): Promise<TransactionSignature>
  async withdrawFees(lamports: bigint): Promise<TransactionSignature>

  // PDA helpers
  getVammStatePDA(): [PublicKey, number]
  getPositionPDA(trader: PublicKey): [PublicKey, number]
  getCollateralVaultPDA(): [PublicKey, number]
  getInsuranceFundPDA(): [PublicKey, number]
}
```

### 8.2 Crank Bot (`/crank/src/index.ts`)

```typescript
class CrankBot {
  private readonly POLL_INTERVAL_MS = 60_000;  // 1 minute
  private readonly FUNDING_PERIOD_S  = 3600;    // 1 hour

  async run(): Promise<void> {
    console.log("Crank bot started");
    while (true) {
      await this.trySettleFunding();
      await this.scanAndLiquidate();
      await sleep(this.POLL_INTERVAL_MS);
    }
  }

  private async trySettleFunding(): Promise<void>
  private async scanAndLiquidate(): Promise<void>
  private async isLiquidatable(position: Position): Promise<boolean>
  private async getMarkPrice(): Promise<number>
  private async getIndexPrice(): Promise<number>
}
```

### 8.3 Next.js UI (`/app/`)

**Pages:**
- `/` — Landing, connect wallet
- `/trade` — Main trading interface
  - Mark price display (live, polls every 5s)
  - Index price (Pyth)
  - Funding rate display
  - Open position form: direction toggle, margin input, leverage slider
  - Open position summary: estimated entry price, liquidation price, fee
  - Active position panel: size, entry, PnL (live), margin ratio, close button
  - Add margin button
- `/stats` — Protocol stats: open interest, fee pool, insurance fund balance

---

## 9. Pyth Oracle Integration (Pull Oracle)

> **Important:** Pyth has migrated from a push-based to a **pull-based** oracle model.
> The legacy push oracle (with hardcoded on-chain price accounts) is **deprecated**.
> This project uses the **Pyth pull oracle** via `pyth-solana-receiver-sdk`.

**SOL/USD Price Feed ID (same on mainnet and devnet):**
```
0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
```

**How pull oracle works:**
1. The **client/frontend** fetches the latest price update from Pyth's **Hermes API**
2. The price update is included as an instruction in the transaction (posted on-chain)
3. The on-chain program reads from the `PriceUpdateV2` account

**Reading the price in Anchor:**
```rust
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

pub const MAX_PRICE_AGE_SECS: u64 = 60;

pub fn read_pyth_price(
    price_update: &Account<PriceUpdateV2>,
    feed_id: &[u8; 32],
) -> Result<u128> {
    let price = price_update
        .get_price_no_older_than(
            &Clock::get()?,
            MAX_PRICE_AGE_SECS,
            feed_id,
        )
        .map_err(|_| PerpError::StalePythPrice)?;

    if price.price <= 0 {
        return Err(PerpError::InvalidOraclePrice.into());
    }

    // Reject if confidence > 1% of price
    if price.conf > (price.price.unsigned_abs() / 100) {
        return Err(PerpError::PythConfidenceTooWide.into());
    }

    // Normalize to SCALE (6 decimals)
    // Pyth prices have variable exponents — adjust accordingly
    let normalized = normalize_pyth_price(price.price, price.exponent)?;
    Ok(normalized)
}

fn normalize_pyth_price(price: i64, expo: i32) -> Result<u128> {
    // Pyth expo is typically -8 for SOL/USD
    // We want 6 decimal places (SCALE = 1_000_000)
    let target_expo: i32 = -6;
    let diff = expo - target_expo;  // typically -2
    let price_u = price.unsigned_abs() as u128;

    let factor = 10u128
        .checked_pow(diff.unsigned_abs())
        .ok_or(PerpError::MathOverflow)?;

    let normalized = if diff < 0 {
        price_u.checked_div(factor)
            .ok_or(PerpError::MathOverflow)?
    } else {
        price_u.checked_mul(factor)
            .ok_or(PerpError::MathOverflow)?
    };

    require!(normalized > 0, PerpError::InvalidOraclePrice);
    Ok(normalized)
}
```

Reject normalization if the exponent delta is too large to compute safely or if normalization
would round the price to zero.

**Client-side: Posting Pyth price updates (TypeScript):**
```typescript
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import { HermesClient } from "@pythnetwork/hermes-client";

const SOL_USD_FEED_ID = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

async function getPriceUpdateInstruction(
  connection: Connection,
  wallet: Wallet
): Promise<TransactionInstruction[]> {
  const hermes = new HermesClient("https://hermes.pyth.network");
  const priceUpdates = await hermes.getLatestPriceUpdates([SOL_USD_FEED_ID]);
  
  const pythReceiver = new PythSolanaReceiver({ connection, wallet });
  return pythReceiver.getPostPriceUpdateInstructions(priceUpdates);
}
```

**Dependencies in `Cargo.toml`:**
```toml
[dependencies]
anchor-lang = { version = "0.31.1", features = ["init-if-needed"] }
pyth-solana-receiver-sdk = "=1.0.0"
```

> **Note:** `anchor-spl` is **not required** since this project only uses native SOL
> as collateral (no SPL tokens). User deposits use `system_program::transfer` CPI; outbound
> payments debit lamports from the program-owned vault PDA.

**npm dependencies for client:**
```json
{
  "@pythnetwork/pyth-solana-receiver": "^0.11.0",
  "@pythnetwork/hermes-client": "^1.4.0",
  "@coral-xyz/anchor": "0.31.1"
}
```

> **Version note:** The verified local build uses Anchor CLI/crates `0.31.1` with
> `pyth-solana-receiver-sdk = "=1.0.0"`. Keep the Pyth version exact; allowing Cargo to float
> to `1.2.0` can resolve incompatible Anchor/Borsh versions in this toolchain.

---

## 10. Funding Rate Mechanism

Funding keeps the perp mark price anchored to the Pyth index price.

**Rate formula (per hour):**
```
premium      = (mark_price_twap - index_price) * SCALE / index_price
funding_rate = premium / 24

// Divide by 24 to express as per-hour rate (funding settles 24x per day)
// mark_price_twap is computed from the ring buffer in VammState (§6.5)
```

> **Note:** The funding formula uses `mark_price_twap` (not spot mark price) to smooth out
> short-term vAMM price spikes. The TWAP is updated each time `settle_funding` is called.

**Payment direction:**
- `funding_rate > 0` → mark > index → longs pay shorts
- `funding_rate < 0` → mark < index → shorts pay longs

**Rate cap:** Funding rate is clamped to `±funding_rate_cap` (default: 100 scaled = 0.01%) per
hour to prevent extreme swings during high volatility. At 24 funding periods per day, the
maximum daily funding is ±0.24%.

**Lazy settlement on add_margin/close/liquidate:**
```rust
let funding_delta = vamm.cumulative_funding_rate
    .checked_sub(position.last_cumulative_funding_rate)
    .ok_or(PerpError::MathOverflow)?;

let index_price = read_pyth_price(&price_update, &vamm.pyth_feed_id)?;

// Convert base size to scaled USD value, then apply the signed scaled funding rate.
let base_value_usd = (position.size as i128)
    .checked_mul(index_price as i128)
    .ok_or(PerpError::MathOverflow)?
    / SCALE as i128;

let funding_payment_usd = base_value_usd
    .checked_mul(funding_delta)
    .ok_or(PerpError::MathOverflow)?
    / SCALE as i128;

// Positive funding_lamports means longs pay shorts. Negative means shorts pay longs.
let funding_lamports = funding_payment_usd
    .checked_mul(LAMPORTS_PER_SOL as i128)
    .ok_or(PerpError::MathOverflow)?
    / index_price as i128;

let signed_margin_delta = match position.direction {
    Direction::Long => funding_lamports.checked_neg().ok_or(PerpError::MathOverflow)?,
    Direction::Short => funding_lamports,
};

apply_funding_delta(
    &mut position.margin,
    &mut vamm.total_margin,
    &mut vamm.funding_pool,
    signed_margin_delta,
)?;
position.last_cumulative_funding_rate = vamm.cumulative_funding_rate;
position.last_funding_ts = Clock::get()?.unix_timestamp;
```

`apply_funding_delta` keeps funding solvent. Negative deltas debit the position up to its
available margin and credit `vamm.funding_pool`; positive deltas debit `vamm.funding_pool`
up to its available balance and credit the position. `vamm.total_margin` changes by the same
amount as `position.margin`. A position whose margin reaches zero becomes liquidatable.

---

## 11. Liquidation Engine

### Margin Ratio Computation

```
unrealised_pnl = f(position, current_mark_price)   // see §4.5/4.6, in scaled USD
margin_usd     = position.margin * index_price / LAMPORTS_PER_SOL  // lamports → USD
equity_usd     = margin_usd + unrealised_pnl
margin_ratio   = equity_usd <= 0 ? 0 : equity_usd * SCALE / position.notional
```

> **Units note:** `position.margin` is in lamports (real SOL), while `position.notional` and
> `unrealised_pnl` are in scaled USD. The margin must be converted to USD using the current
> index price before computing the ratio.

### Liquidation Condition

```
margin_ratio < maintenance_margin_ratio (0.0625)
```

### Liquidation Payout Waterfall

```
1. Unwind position on vAMM → get quote_received
2. remaining = position.margin + pnl_lamports

Case A — remaining >= 0 (solvent liquidation):
  liquidator_fee = remaining * 2.5%
  insurance_cut  = remaining * 0.5%
  trader_refund  = remaining - liquidator_fee - insurance_cut
  (trader_refund may be 0 — liquidation leaves little)

Case B — remaining < 0 (bad debt):
  deficit covered by insurance fund
  liquidator receives no fee in the MVP bad-debt path
```

### Crank Liquidation Scan

```typescript
async scanAndLiquidate() {
  const positions = await program.account.position.all([
    { memcmp: { offset: 8 + 32, bytes: VAMM_ADDRESS.toBase58() } }
  ]);

  const markPrice = await sdk.getMarkPrice();

  for (const { publicKey, account } of positions) {
    const liqPrice = account.liquidationPrice.toNumber() / SCALE;
    const shouldLiquidate =
      account.direction.long  ? markPrice <= liqPrice :
      account.direction.short ? markPrice >= liqPrice : false;

    if (shouldLiquidate) {
      const marginRatio = await sdk.getMarginRatio(account.trader);
      if (marginRatio < 0.0625) {
        await program.methods
          .liquidate(account.trader)
          .accounts({ /* ... */ })
          .rpc();
      }
    }
  }
}
```

---

## 12. Fee Structure

| Fee | Rate | Recipient |
|---|---|---|
| Open position | 0.10% of notional | Fee pool (VammState) |
| Close position | 0.10% of notional | Fee pool (VammState) |
| Liquidation fee | 2.50% of remaining margin | Liquidator (crank) |
| Insurance cut on liquidation | 0.50% of remaining margin | Insurance fund |
| Bad debt coverage | Up to fund balance | From insurance fund |
| Funding payments | Capped by available funding pool | Between position margin and `VammState.funding_pool` |

Fee pool accumulates in `VammState.fee_pool` (tracked in lamports). Admin can withdraw via the `withdraw_fees` instruction (§6.9).

> **Fee units:** All fees are computed and stored in **lamports** (real SOL). The trading fee
> is calculated as a percentage of the notional exposure in SOL terms. Opening fees are paid
> in addition to posted margin:
> `open_fee_lamports = margin_lamports * leverage * TRADING_FEE_BPS / 10000`.
> Closing fees use exit notional:
> `close_fee_lamports = exit_notional_usd * LAMPORTS_PER_SOL / index_price * TRADING_FEE_BPS / 10000`.

---

## 13. Security Constraints

| Constraint | Implementation |
|---|---|
| Signer checks | Every mutating instruction requires `trader` or `authority` as signer |
| PDA validation | PDA seeds and bumps enforced; collateral vault is a zero-data program-owned PDA |
| Oracle staleness | Reject Pyth prices older than 60 seconds |
| Oracle confidence | Reject if confidence interval > 1% of price |
| Oracle sign | Reject zero or negative oracle prices |
| Overflow protection | `checked_mul`, `checked_div`, `checked_add` everywhere |
| Reserve safety | Reject zero-size trades and trades that exhaust base/quote reserves |
| Vault solvency | Track `total_margin` and `funding_pool`; prevent fee withdrawals that would uncover either reserve |
| One position per trader | Check in `open_position` via PDA uniqueness |
| Max leverage cap | Enforced on-chain in `open_position` |
| Pause mechanism | `vamm.paused` blocks all opens; closes always available |
| Admin-only instructions | `update_vamm`, `toggle_pause`, `withdraw_fees` check `authority` signer |
| No self-liquidation | `liquidator != position.trader` check in `liquidate` |
| Pyth pull oracle | Price updates must be included in every price-reading tx |
| Feed ID validation | On-chain feed ID checked against stored `pyth_feed_id` |
| Pyth receiver ownership | Use `Account<'info, PriceUpdateV2>` so Anchor checks the receiver account owner |
| Pyth verification level | Use `get_price_no_older_than` for full verification unless a stricter custom policy is specified |

---

## 14. Program Derived Addresses (PDAs)

| Account | Seeds | Notes |
|---|---|---|
| `VammState` | `["vamm_state"]` | Singleton |
| `Position` | `["position", trader_pubkey]` | One per trader |
| `CollateralVault` | `["collateral_vault"]` | Holds SOL lamports |
| `InsuranceFund` | `["insurance_fund"]` | Holds SOL lamports |

All PDA addresses are derived with this program ID. `VammState`, `Position`, and
`InsuranceFund` are program-owned data accounts. `CollateralVault` is a zero-data
program-owned PDA; deposits use `system_program::transfer`, and outbound payments are
program-owned lamport debits. Bump seeds are stored in each program-owned data account and
derived consistently in the client.

---

## 15. Test Plan

### Unit Tests (TypeScript — off-chain math)

```
vamm_math.test.ts
  ✓ open long: reserves update correctly
  ✓ open short: reserves update correctly
  ✓ close long: pnl positive when price rises
  ✓ close long: pnl negative when price falls
  ✓ close short: pnl positive when price falls
  ✓ liquidation price: correct for 10x long
  ✓ liquidation price: correct for 5x short
  ✓ funding rate: positive when mark > index
  ✓ funding rate: negative when mark < index
  ✓ funding payment: negative funding makes longs receive and shorts pay
  ✓ margin ratio: falls as price moves against position
  ✓ overflow: handles large u128 multiplications correctly
  ✓ scaling: SCALE factor consistent across all functions
  ✓ scaling: mark and entry prices include SCALE multiplier
  ✓ edge: zero-size output is rejected
  ✓ edge: short cannot exhaust quote reserve
  ✓ edge: negative equity returns margin ratio 0
```

### Integration Tests (Anchor / Bankrun)

```
perp.test.ts
  initialize
    ✓ sets correct reserves and k invariant
    ✓ creates vault and insurance fund PDAs
    ✓ rejects if already initialized

  open_position
    ✓ long: transfers SOL to vault
    ✓ long: updates vAMM reserves correctly
    ✓ long: stores correct entry price and liquidation price
    ✓ short: reserves move in opposite direction
    ✓ rejects leverage > max_leverage
    ✓ rejects margin below minimum
    ✓ rejects if position already open
    ✓ rejects when vAMM paused
    ✓ rejects stale, negative, or wide-confidence oracle prices
    ✓ rejects zero-size trades after fixed-point rounding
    ✓ rejects trades that would exhaust vAMM reserves
    ✓ collects opening fee in addition to margin

  close_position
    ✓ long profitable: trader receives margin + pnl
    ✓ long loss: trader receives margin - loss
    ✓ short profitable: trader receives margin + pnl
    ✓ charges close fee based on exit notional
    ✓ does not add uncollected close fees to fee_pool
    ✓ insurance fund covers vault shortfall when payout exceeds vault balance
    ✓ restores vAMM reserves after close
    ✓ closes position account (rent returned)

  add_margin
    ✓ increases position.margin
    ✓ settles pending funding before increasing margin
    ✓ updates liquidation_price
    ✓ rejects zero lamport add_margin

  settle_funding
    ✓ updates cumulative_funding_rate
    ✓ rejects if called too soon
    ✓ permissionless (any signer)
    ✓ clamps positive and negative funding to funding_rate_cap
    ✓ updates TWAP ring buffer index and count
    ✓ funding debits increase funding_pool
    ✓ funding credits are capped by available funding_pool

  liquidate
    ✓ succeeds when margin_ratio < threshold
    ✓ rejects when position is healthy
    ✓ rejects self-liquidation
    ✓ pays liquidation fee to crank
    ✓ pays insurance cut and trader refund for solvent liquidation
    ✓ covers bad debt from insurance fund
    ✓ increments insurance_fund.total_payouts on bad debt
    ✓ handles zero/negative equity without unsigned underflow
    ✓ closes position account

  admin
    ✓ update_vamm rejects when open_interest > 0
    ✓ update_vamm rejects reserves more than 20% away from oracle
    ✓ withdraw_fees cannot reduce vault below total_margin + funding_pool
```

### Devnet Manual Test Scenarios

```
Scenario 1 — Happy path long
  1. Open 0.1 SOL margin, 5x leverage, long
  2. Wait — Pyth price moves up
  3. Close position — verify positive PnL received

Scenario 2 — Liquidation
  1. Open 0.01 SOL margin, 10x leverage, long
  2. Trigger crank — simulate price drop past liquidation_price
  3. Verify crank receives liquidation fee
  4. Verify position account closed

Scenario 3 — Funding rate
  1. Open long position
  2. Advance 1 hour (or mock timestamp on localnet)
  3. Call settle_funding
  4. Close position — verify funding was deducted from margin

Scenario 4 — Bad debt
  1. Open highly leveraged position
  2. Price moves far past liquidation with no margin left
  3. Verify insurance fund covers deficit
```

---

## 16. Day-by-Day Build Plan

### Day 1 — Off-chain math (TypeScript)
- Create `/math/` directory
- Implement all vAMM math as pure TS functions with `BigInt`
- Write all unit tests — must be green before touching Rust
- Implement `computeOpenLong`, `computeOpenShort`, `computeClose`, `computeLiqPrice`, `computeFunding`, `computeMarginRatio`

### Day 2 — Anchor scaffold + `initialize` + `open_position`
- `anchor init vortex-perp`
- Define all account structs in `state.rs`
- Define all error codes in `errors.rs`
- Implement `initialize` instruction
- Implement `open_position` (no Pyth yet — hardcode price)
- Write Anchor tests for both
- Deploy to localnet: `anchor test`

### Day 3 — Pyth + `close_position` + `add_margin`
- Add `pyth-solana-receiver-sdk` dependency
- Integrate Pyth price reading with staleness and confidence checks
- Implement `close_position` with full PnL settlement
- Implement `add_margin`
- Test round-trip: open → close (verify vault balance)

### Day 4 — `settle_funding` + `liquidate` + insurance fund
- Implement cumulative funding rate tracking
- Implement lazy funding settlement in close
- Implement `liquidate` with full waterfall
- Test liquidation on localnet by manipulating vAMM reserves to crash mark price

### Day 5 — TypeScript SDK + crank bot
- Build `PerpSDK` class with all read/write methods
- Build `CrankBot` with funding + liquidation loops
- Deploy program to devnet
- Run crank bot against devnet — open 3 positions and watch it scan

### Day 6 — Next.js UI + devnet hardening
- Scaffold Next.js with `@solana/wallet-adapter`
- Build `/trade` page: connect → open position → live PnL → close
- Add Pyth live price display
- Add funding rate display
- Fix any devnet bugs found during UI testing

### Day 7 — Polish, README, demo
- Write `README.md` with setup instructions
- Write architecture explanation (can use this SPEC)
- Record 3-minute demo video
- Prepare 5-minute judge presentation
- Clean up any known edge cases in error handling

---

## 17. Deliverables & Demo Script

### Deliverables

```
vortex-perp/
├── programs/
│   └── vortex-perp/
│       ├── src/
│       │   ├── lib.rs          ← instruction routing
│       │   ├── instructions/
│       │   │   ├── mod.rs
│       │   │   ├── initialize.rs
│       │   │   ├── open_position.rs
│       │   │   ├── close_position.rs
│       │   │   ├── add_margin.rs
│       │   │   ├── settle_funding.rs
│       │   │   ├── liquidate.rs
│       │   │   ├── update_vamm.rs
│       │   │   ├── toggle_pause.rs
│       │   │   └── withdraw_fees.rs
│       │   ├── state.rs        ← VammState, Position, InsuranceFund, Direction
│       │   ├── errors.rs       ← PerpError enum
│       │   ├── events.rs       ← Event structs
│       │   ├── math.rs         ← vAMM math functions (Rust)
│       │   └── constants.rs    ← SCALE, FUNDING_PERIOD, etc.
│       └── Cargo.toml
├── sdk/
│   └── src/
│       ├── index.ts            ← PerpSDK class
│       ├── math.ts             ← vAMM math (TypeScript, mirrors Rust)
│       ├── pyth.ts             ← Pyth pull oracle helpers (Hermes + posting)
│       └── pdas.ts             ← PDA derivation helpers
├── crank/
│   └── src/
│       └── index.ts            ← CrankBot
├── app/
│   └── src/
│       └── pages/
│           └── trade.tsx       ← Trading UI
├── math/
│   └── *.test.ts               ← Off-chain math unit tests
├── tests/
│   └── perp.test.ts            ← Anchor integration tests
├── Anchor.toml
├── Cargo.toml
├── SPEC.md                     ← this file
└── README.md
```

### 3-Minute Demo Script

```
00:00  Show Solana devnet explorer — program deployed at address X
00:20  Connect Phantom wallet (devnet)
00:30  Show current SOL/USD price from Pyth: $XX.XX
00:45  Open position — 0.1 SOL margin, 5x leverage, LONG
        → Show transaction on explorer
        → Show position panel: entry price, liq price, PnL = $0
01:15  Pyth price ticks up / down — PnL updates live
01:30  Close position — show PnL settled, SOL returned to wallet
01:50  Open a second position with 10x leverage, tiny margin
        → Manually call settle_funding in a second terminal
        → Show crank bot triggering liquidation
02:30  Show insurance fund PDA — lamports accumulated
02:45  Summarize: vAMM math, Pyth oracle, crank bot, no order book needed
03:00  Done
```

---

## 18. Known Limitations & Future Work

| Limitation | Production Solution |
|---|---|
| One position per trader | Multi-position support with position index |
| Full liquidation only | Partial liquidation (close 50% to restore margin ratio) |
| Single market | Market registry with multiple VammState accounts |
| SOL collateral only | USDC via SPL Token + Token-2022 |
| Mark TWAP only 8 samples | Larger ring buffer (24+ samples) for smoother TWAP |
| Crank centralisation | Permissionless crank with reward auction (MEV) |
| No remove_margin instruction | Allow traders to withdraw excess margin |
| Scanner is O(n) positions | Geyser plugin + off-chain index for sub-second scanning |
| No position size limits | Open interest caps to prevent vAMM price manipulation |
| k is static | Dynamic k adjustment tied to open interest (like dYdX) |
| No partial close | Allow closing a fraction of position size |
| Funding receivers capped by funding_pool | Track unpaid funding credits or settle funding globally with indexed positions |
| Pyth pull oracle adds tx size | Optimize by batching price updates across instructions |
| Anchor pinned to 0.31.1 | Upgrade only after Pyth receiver SDK compatibility is verified |

---

*Generated for Solana Fellowship Capstone — VortexPerp: vAMM Perpetual Futures Engine*
*Target: Solana devnet · Anchor 0.31.1 · Pyth pull oracle (devnet)*
