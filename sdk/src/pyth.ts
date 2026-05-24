import { HermesClient } from "@pythnetwork/hermes-client";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import {
  ComputeBudgetProgram,
  type Connection,
  type PublicKey,
  type Signer,
  type TransactionInstruction,
} from "@solana/web3.js";

import { SOL_USD_FEED_ID } from "./constants.js";
import type { BrowserAnchorWallet } from "./index.js";

export interface PostedPriceUpdate {
  postInstructions: TransactionInstruction[];
  closeInstructions: TransactionInstruction[];
  signers: Signer[];
  priceUpdateAccount: PublicKey;
}

export async function getPriceUpdateInstructions(
  connection: Connection,
  wallet: BrowserAnchorWallet,
  feedIds = [SOL_USD_FEED_ID],
): Promise<PostedPriceUpdate> {
  const hermes = new HermesClient("https://hermes.pyth.network");
  const priceUpdates = await hermes.getLatestPriceUpdates(feedIds, { encoding: "base64" });
  const receiver = new PythSolanaReceiver({ connection, wallet: wallet as any });
  const built = await receiver.buildPostPriceUpdateAtomicInstructions(priceUpdates.binary.data);
  const firstFeed = normalizeFeedId(feedIds[0]);
  const priceUpdateAccount = built.priceFeedIdToPriceUpdateAccount[firstFeed];
  if (!priceUpdateAccount) {
    throw new Error(`Pyth did not return a posted price update account for feed ${firstFeed}`);
  }
  const postInstructions = built.postInstructions.map((item: any) => item.instruction ?? item);
  const closeInstructions = built.closeInstructions.map((item: any) => item.instruction ?? item);

  return {
    postInstructions: [buildComputeBudgetInstruction(built.postInstructions), ...postInstructions],
    closeInstructions,
    signers: collectEphemeralSigners(built.postInstructions, built.closeInstructions),
    priceUpdateAccount,
  };
}

export async function getSolUsdPrice(): Promise<number> {
  const hermes = new HermesClient("https://hermes.pyth.network");
  const update = await hermes.getLatestPriceUpdates([SOL_USD_FEED_ID]);
  const parsed = update.parsed?.[0]?.price;
  if (!parsed) throw new Error("SOL/USD price unavailable");
  return Number(parsed.price) * 10 ** parsed.expo;
}

function normalizeFeedId(feedId: string): string {
  const value = feedId.toLowerCase();
  return value.startsWith("0x") ? value : `0x${value}`;
}

function collectEphemeralSigners(...instructionGroups: any[][]): Signer[] {
  return instructionGroups.flatMap((instructions) =>
    instructions.flatMap((item) => item.signers ?? []),
  );
}

function buildComputeBudgetInstruction(instructions: any[]): TransactionInstruction {
  const requestedUnits = instructions.reduce(
    (total, item) => total + Number(item.computeUnits ?? 0),
    150_000,
  );
  return ComputeBudgetProgram.setComputeUnitLimit({
    units: Math.min(Math.max(requestedUnits, 350_000), 1_400_000),
  });
}
