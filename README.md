# VortexPerp

VortexPerp is a Solana/Anchor vAMM perpetual futures MVP for SOL/USD. It includes:

- Anchor program with SOL collateral vault, vAMM math, funding, liquidation, and admin controls
- Pyth pull oracle integration through `pyth-solana-receiver-sdk`
- TypeScript SDK helpers, PDA derivation, and BigInt math tests
- Crank bot skeleton for funding/liquidation scans
- Next.js demo trading UI

## Toolchain

- Anchor CLI `0.31.1`
- `anchor-lang = 0.31.1`
- `pyth-solana-receiver-sdk = =1.0.0`
- pnpm `10.x`
- Node `20.x`

The Pyth SDK version is intentionally exact. Floating to newer `1.x` releases can resolve
incompatible Anchor/Borsh versions with this toolchain.

## Setup

```bash
pnpm install
cargo check
anchor build
pnpm test
pnpm --filter @vortex-perp/app build
```

## Development

```bash
pnpm app:dev
pnpm crank
```

The app renders a devnet trading surface wired to the generated IDL. It can initialize the market,
open a position, add margin, close the connected wallet's position, and refresh the market/position
PDAs. Trade actions post a Pyth pull-oracle update before the program instruction.

To test wallet transactions on devnet:

```bash
anchor build
anchor deploy --provider.cluster devnet
pnpm app:dev
```

Open `http://localhost:3000`, connect a devnet-funded wallet, initialize the market if the market
PDA does not exist, then open/close a small position. The app links successful transactions to the
Solana devnet explorer.
