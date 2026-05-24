import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { PerpSDK, PROGRAM_ID } from "../../sdk/src/index.js";

const POLL_INTERVAL_MS = 60_000;
const FUNDING_PERIOD_S = 3_600;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CrankBot {
  private readonly sdk: PerpSDK;

  constructor(
    readonly connection: Connection,
    readonly program: Program,
    readonly wallet: Wallet,
  ) {
    this.sdk = new PerpSDK(connection, program, wallet);
  }

  async run(): Promise<void> {
    console.log("Crank bot started", { programId: PROGRAM_ID, fundingPeriod: FUNDING_PERIOD_S });
    while (true) {
      await this.trySettleFunding();
      await this.scanAndLiquidate();
      await sleep(POLL_INTERVAL_MS);
    }
  }

  private async trySettleFunding(): Promise<void> {
    const vamm = await this.sdk.getVammState();
    console.log("funding scan", { lastFundingTs: vamm.lastFundingTs?.toString?.() });
  }

  private async scanAndLiquidate(): Promise<void> {
    const [vammState] = this.sdk.getVammStatePDA();
    const positions = await (this.program.account as any).position.all([
      { memcmp: { offset: 8 + 32, bytes: vammState.toBase58() } },
    ]);
    console.log("liquidation scan", { positions: positions.length });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, wallet, {});
  const idl = { address: PROGRAM_ID, instructions: [], accounts: [] };
  const program = new Program(idl as never, provider);
  const bot = new CrankBot(connection, program, wallet);
  bot.run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
