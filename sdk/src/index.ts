import type { Program } from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import type { Connection, TransactionSignature } from "@solana/web3.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import { LAMPORTS_PER_SOL, PROGRAM_ID, SCALE, SOL_USD_FEED_ID } from "./constants.js";
import { getPriceUpdateInstructions } from "./pyth.js";
import {
  getCollateralVaultPda,
  getInsuranceFundPda,
  getPositionPda,
  getVammStatePda,
} from "./pdas.js";

export interface BrowserAnchorWallet {
  publicKey: PublicKey;
  signTransaction: (...args: any[]) => Promise<any>;
  signAllTransactions: (...args: any[]) => Promise<any[]>;
}

export class PerpSDK {
  readonly programId = new PublicKey(PROGRAM_ID);

  constructor(
    readonly connection: Connection,
    readonly program: Program,
    readonly wallet: BrowserAnchorWallet,
  ) {}

  async getVammState() {
    const [vammState] = this.getVammStatePDA();
    return (this.program.account as any).vammState.fetch(vammState);
  }

  async getPosition(trader: PublicKey): Promise<unknown | null> {
    const [position] = this.getPositionPDA(trader);
    try {
      return await (this.program.account as any).position.fetch(position);
    } catch {
      return null;
    }
  }

  async initializeMarket(
    baseAssetReserve = 1_000_000n * SCALE,
    quoteAssetReserve = 20_000_000n * SCALE,
    feedId = SOL_USD_FEED_ID,
  ): Promise<TransactionSignature> {
    const [vammState] = this.getVammStatePDA();
    const [collateralVault] = this.getCollateralVaultPDA();
    const [insuranceFund] = this.getInsuranceFundPDA();

    return this.program.methods
      .initialize(
        new BN(baseAssetReserve.toString()),
        new BN(quoteAssetReserve.toString()),
        feedIdToBytes(feedId),
      )
      .accounts({
        authority: this.wallet.publicKey,
        vammState,
        collateralVault,
        insuranceFund,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async openPosition(
    direction: "long" | "short",
    marginSol: number,
    leverage: number,
  ): Promise<TransactionSignature> {
    const marginLamports = BigInt(Math.round(marginSol * Number(LAMPORTS_PER_SOL)));
    const priceUpdate = await getPriceUpdateInstructions(this.connection, this.wallet);
    const [vammState] = this.getVammStatePDA();
    const [position] = this.getPositionPDA(this.wallet.publicKey);
    const [collateralVault] = this.getCollateralVaultPDA();

    return this.program.methods
      .openPosition(
        direction === "long" ? { long: {} } : { short: {} },
        new BN(marginLamports.toString()),
        leverage,
      )
      .preInstructions(priceUpdate.postInstructions)
      .postInstructions(priceUpdate.closeInstructions)
      .signers(priceUpdate.signers)
      .accounts({
        trader: this.wallet.publicKey,
        vammState,
        position,
        collateralVault,
        priceUpdate: priceUpdate.priceUpdateAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async closePosition(): Promise<TransactionSignature> {
    const priceUpdate = await getPriceUpdateInstructions(this.connection, this.wallet);
    const [vammState] = this.getVammStatePDA();
    const [position] = this.getPositionPDA(this.wallet.publicKey);
    const [collateralVault] = this.getCollateralVaultPDA();
    const [insuranceFund] = this.getInsuranceFundPDA();

    return this.program.methods
      .closePosition()
      .preInstructions(priceUpdate.postInstructions)
      .postInstructions(priceUpdate.closeInstructions)
      .signers(priceUpdate.signers)
      .accounts({
        trader: this.wallet.publicKey,
        vammState,
        position,
        collateralVault,
        insuranceFund,
        priceUpdate: priceUpdate.priceUpdateAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async addMargin(solAmount: number): Promise<TransactionSignature> {
    const lamports = BigInt(Math.round(solAmount * Number(LAMPORTS_PER_SOL)));
    const priceUpdate = await getPriceUpdateInstructions(this.connection, this.wallet);
    const [vammState] = this.getVammStatePDA();
    const [position] = this.getPositionPDA(this.wallet.publicKey);
    const [collateralVault] = this.getCollateralVaultPDA();

    return this.program.methods
      .addMargin(new BN(lamports.toString()))
      .preInstructions(priceUpdate.postInstructions)
      .postInstructions(priceUpdate.closeInstructions)
      .signers(priceUpdate.signers)
      .accounts({
        trader: this.wallet.publicKey,
        vammState,
        position,
        collateralVault,
        priceUpdate: priceUpdate.priceUpdateAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  getVammStatePDA(): [PublicKey, number] {
    return getVammStatePda(this.programId);
  }

  getPositionPDA(trader: PublicKey): [PublicKey, number] {
    return getPositionPda(trader, this.programId);
  }

  getCollateralVaultPDA(): [PublicKey, number] {
    return getCollateralVaultPda(this.programId);
  }

  getInsuranceFundPDA(): [PublicKey, number] {
    return getInsuranceFundPda(this.programId);
  }
}

export * from "./constants.js";
export * from "./math.js";
export * from "./pdas.js";
export * from "./pyth.js";

function feedIdToBytes(feedId: string): number[] {
  const hex = feedId.replace(/^0x/, "");
  if (hex.length !== 64) {
    throw new Error("Pyth feed id must be 32 bytes");
  }
  return Array.from({ length: 32 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}
