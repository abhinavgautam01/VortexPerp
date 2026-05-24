import { PublicKey } from "@solana/web3.js";

import { PROGRAM_ID } from "./constants.js";

export const programId = new PublicKey(PROGRAM_ID);

export function getVammStatePda(program = programId): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("vamm_state")], program);
}

export function getPositionPda(
  trader: PublicKey,
  program = programId,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), trader.toBuffer()],
    program,
  );
}

export function getCollateralVaultPda(program = programId): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("collateral_vault")], program);
}

export function getInsuranceFundPda(program = programId): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("insurance_fund")], program);
}
