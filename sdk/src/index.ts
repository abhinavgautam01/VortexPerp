import type { Program } from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import type {
  Connection,
  Signer,
  TransactionInstruction,
  TransactionSignature,
  VersionedTransaction,
} from "@solana/web3.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import { LAMPORTS_PER_SOL, PROGRAM_ID, SCALE, SOL_USD_FEED_ID } from "./constants.js";
import { preparePriceUpdateTransactionBuilder } from "./pyth.js";
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

interface VersionedTransactionWithSigners {
  tx: VersionedTransaction;
  signers: Signer[];
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
    const [vammState] = this.getVammStatePDA();
    const [position] = this.getPositionPDA(this.wallet.publicKey);
    const [collateralVault] = this.getCollateralVaultPDA();

    return this.sendOracleBackedTransaction(async (priceUpdateAccount) =>
      this.program.methods
        .openPosition(
          direction === "long" ? { long: {} } : { short: {} },
          new BN(marginLamports.toString()),
          leverage,
        )
        .accounts({
          trader: this.wallet.publicKey,
          vammState,
          position,
          collateralVault,
          priceUpdate: priceUpdateAccount,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
  }

  async closePosition(): Promise<TransactionSignature> {
    const [vammState] = this.getVammStatePDA();
    const [position] = this.getPositionPDA(this.wallet.publicKey);
    const [collateralVault] = this.getCollateralVaultPDA();
    const [insuranceFund] = this.getInsuranceFundPDA();

    return this.sendOracleBackedTransaction(async (priceUpdateAccount) =>
      this.program.methods
        .closePosition()
        .accounts({
          trader: this.wallet.publicKey,
          vammState,
          position,
          collateralVault,
          insuranceFund,
          priceUpdate: priceUpdateAccount,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
  }

  async addMargin(solAmount: number): Promise<TransactionSignature> {
    const lamports = BigInt(Math.round(solAmount * Number(LAMPORTS_PER_SOL)));
    const [vammState] = this.getVammStatePDA();
    const [position] = this.getPositionPDA(this.wallet.publicKey);
    const [collateralVault] = this.getCollateralVaultPDA();

    return this.sendOracleBackedTransaction(async (priceUpdateAccount) =>
      this.program.methods
        .addMargin(new BN(lamports.toString()))
        .accounts({
          trader: this.wallet.publicKey,
          vammState,
          position,
          collateralVault,
          priceUpdate: priceUpdateAccount,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
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

  private async sendOracleBackedTransaction(
    buildConsumerInstruction: (priceUpdateAccount: PublicKey) => Promise<TransactionInstruction>,
  ): Promise<TransactionSignature> {
    const { transactionBuilder, priceUpdateAccount } = await preparePriceUpdateTransactionBuilder(
      this.connection,
      this.wallet,
    );
    transactionBuilder.addInstructions([
      {
        instruction: await buildConsumerInstruction(priceUpdateAccount),
        signers: [],
        computeUnits: 150_000,
      },
    ]);

    const transactions = (await transactionBuilder.buildVersionedTransactions({
      computeUnitPriceMicroLamports: 50_000,
      tightComputeBudget: true,
    })) as VersionedTransactionWithSigners[];

    for (const { tx, signers } of transactions) {
      tx.sign(signers);
    }

    const signedTransactions = await this.wallet.signAllTransactions(transactions.map(({ tx }) => tx));
    let signature = "";
    for (const signed of signedTransactions) {
      signature = await this.connection.sendRawTransaction(signed.serialize(), {
        preflightCommitment: "confirmed",
      });
      await this.connection.confirmTransaction(signature, "confirmed");
    }

    return signature;
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
