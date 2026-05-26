"use client";

import type { Idl } from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
  CheckCircle2,
  Code2,
  Database,
  ExternalLink,
  RefreshCw,
  Shield,
  Wallet as WalletIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import idl from "../../../target/idl/vortex_perp.json";
import {
  LAMPORTS_PER_SOL,
  MAX_LEVERAGE,
  MIN_MARGIN_LAMPORTS,
  PROGRAM_ID,
  SCALE,
  SOL_USD_FEED_ID,
} from "../../../sdk/src/constants";
import { PerpSDK } from "../../../sdk/src/index";
import {
  formatScaled,
  markPrice,
  notionalUsdFromLamports,
  openLong,
  openShort,
  tradingFeeLamports,
} from "../../../sdk/src/math";

const baseAssetReserve = 1_000_000n * SCALE;
const quoteAssetReserve = 20_000_000n * SCALE;
const vammState = {
  baseAssetReserve,
  quoteAssetReserve,
  k: baseAssetReserve * quoteAssetReserve,
};

const implementedInstructions = [
  "Initialize market",
  "Open position",
  "Close position",
  "Add margin",
  "Settle funding",
  "Liquidate unhealthy positions",
  "Update vAMM reserves",
  "Pause / unpause market",
  "Withdraw protocol fees",
];

const programAccounts = [
  "vAMM state PDA",
  "Trader position PDA",
  "Program-owned collateral vault",
  "Insurance fund PDA",
  "Pyth SOL/USD price update account",
];

const programPublicKey = new PublicKey(PROGRAM_ID);

type MarketSummary = {
  authority: string;
  markPrice: string;
  openInterest: string;
  totalMarginSol: string;
  feePoolSol: string;
  paused: boolean;
};

type PositionSummary = {
  direction: string;
  size: string;
  notional: string;
  marginSol: string;
  entryPrice: string;
  liquidationPrice: string;
  leverage: string;
};

type ActionState = {
  status: "idle" | "pending" | "success" | "error";
  message: string;
  signature?: string;
};

type BrowserAnchorWallet = {
  publicKey: PublicKey;
  signTransaction: NonNullable<ReturnType<typeof useWallet>["signTransaction"]>;
  signAllTransactions: NonNullable<ReturnType<typeof useWallet>["signAllTransactions"]>;
};

export default function Page() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [mounted, setMounted] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [splashFade, setSplashFade] = useState(false);
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [margin, setMargin] = useState("0.10");
  const [addMargin, setAddMargin] = useState("0.05");
  const [leverage, setLeverage] = useState(5);
  const [programDeployed, setProgramDeployed] = useState<boolean | null>(null);
  const [market, setMarket] = useState<MarketSummary | null>(null);
  const [position, setPosition] = useState<PositionSummary | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>({
    status: "idle",
    message: "Connect a wallet, deploy the program, then initialize the market.",
  });

  useEffect(() => {
    setMounted(true);
    
    // Lock scrollbar on body during splash transition
    if (typeof document !== "undefined") {
      document.body.classList.add("splash-active");
    }

    const fadeTimer = setTimeout(() => {
      setSplashFade(true);
    }, 2000);

    const unmountTimer = setTimeout(() => {
      setShowSplash(false);
      // Restore standard scrollbar after splash unmounts
      if (typeof document !== "undefined") {
        document.body.classList.remove("splash-active");
      }
    }, 2500);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(unmountTimer);
      if (typeof document !== "undefined") {
        document.body.classList.remove("splash-active");
      }
    };
  }, []);

  const anchorWallet = useMemo<BrowserAnchorWallet | null>(() => {
    if (!mounted) return null;
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) return null;
    return {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction,
      signAllTransactions: wallet.signAllTransactions,
    };
  }, [mounted, wallet.publicKey, wallet.signAllTransactions, wallet.signTransaction]);

  const sdk = useMemo(() => {
    if (!anchorWallet) return null;
    const provider = new AnchorProvider(connection, anchorWallet as AnchorProvider["wallet"], {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    const program = new Program(idl as Idl, provider);
    return new PerpSDK(connection, program, anchorWallet);
  }, [anchorWallet, connection]);

  const preview = useMemo(() => {
    const marginSol = Number(margin || "0");
    const safeMarginSol = Number.isFinite(marginSol) && marginSol > 0 ? marginSol : 0;
    const marginLamports = BigInt(Math.round(safeMarginSol * Number(LAMPORTS_PER_SOL)));
    const indexPrice = markPrice(vammState);
    const notional = notionalUsdFromLamports(marginLamports, BigInt(leverage), indexPrice);
    const fee = tradingFeeLamports(marginLamports, BigInt(leverage));

    if (marginLamports < MIN_MARGIN_LAMPORTS || notional <= 0n) {
      return {
        ready: false,
        mark: formatScaled(indexPrice, 2),
        marginSol: safeMarginSol.toFixed(4),
        notional: formatScaled(notional, 2),
        feeSol: lamportsToSol(fee),
        size: "-",
        entry: "-",
        liquidation: "-",
      };
    }

    const opened =
      direction === "long"
        ? openLong(vammState, notional, marginLamports, indexPrice)
        : openShort(vammState, notional, marginLamports, indexPrice);

    return {
      ready: true,
      mark: formatScaled(indexPrice, 2),
      marginSol: safeMarginSol.toFixed(4),
      notional: formatScaled(notional, 2),
      feeSol: lamportsToSol(fee),
      size: formatScaled(opened.size, 4),
      entry: formatScaled(opened.entryPrice, 2),
      liquidation: formatScaled(opened.liquidationPrice, 2),
    };
  }, [direction, margin, leverage]);

  const refreshState = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const programInfo = await connection.getAccountInfo(programPublicKey, "confirmed");
      setProgramDeployed(Boolean(programInfo?.executable));

      if (!sdk || !wallet.publicKey) {
        setMarket(null);
        setPosition(null);
        return;
      }

      try {
        const account = await sdk.getVammState();
        setMarket(toMarketSummary(account));
      } catch {
        setMarket(null);
      }

      const account = await sdk.getPosition(wallet.publicKey);
      setPosition(account ? toPositionSummary(account) : null);
    } finally {
      setIsRefreshing(false);
    }
  }, [connection, sdk, wallet.publicKey]);

  useEffect(() => {
    if (!mounted) return;
    void refreshState();
  }, [mounted, refreshState]);

  const runTransaction = async (label: string, execute: () => Promise<string>) => {
    if (!sdk || !wallet.publicKey) {
      setActionState({ status: "error", message: "Connect a wallet first." });
      return;
    }

    setBusyAction(label);
    setActionState({ status: "pending", message: `${label} transaction is waiting for wallet approval.` });
    try {
      const signature = await execute();
      setActionState({
        status: "success",
        message: `${label} confirmed.`,
        signature,
      });
      await refreshState();
    } catch (error) {
      setActionState({
        status: "error",
        message: toErrorMessage(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const isWalletReady = Boolean(sdk && wallet.publicKey);
  const existingDirection = position?.direction.toLowerCase();
  const tradeLabel = !position
    ? `Open ${direction === "long" ? "Long" : "Short"}`
    : existingDirection === direction
      ? `Increase ${direction === "long" ? "Long" : "Short"}`
      : `Reduce / Flip ${direction === "long" ? "Long" : "Short"}`;
  const canInitialize = isWalletReady && programDeployed === true && !market && !busyAction;
  const canOpen = isWalletReady && programDeployed === true && Boolean(market) && preview.ready && !busyAction;
  const canClose = isWalletReady && programDeployed === true && Boolean(position) && !busyAction;
  const canAddMargin = canClose && Number(addMargin) > 0;

  return (
    <main className={`app-shell direction-${direction}`}>
      {showSplash && (
        <div className={`splash-screen ${splashFade ? "fade-out" : ""}`}>
          <div className="splash-content">
            <svg
              className="splash-logo"
              viewBox="0 0 24 24"
              width="72"
              height="72"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M4 5L12 19L20 5"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M7 8L12 16.5L17 8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.7"
              />
              <path
                d="M10 11L12 14L14 11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.4"
              />
            </svg>
            <h1 className="splash-title">VortexPerp</h1>
            <p className="splash-subtitle">SOL Isolated Perpetuals</p>
          </div>
        </div>
      )}
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">
            <svg
              className="vortex-logo-svg"
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M4 5L12 19L20 5"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M7 8L12 16.5L17 8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.7"
              />
              <path
                d="M10 11L12 14L14 11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.4"
              />
            </svg>
          </span>
          <div>
            <strong>VortexPerp</strong>
            <span>SOL isolated perpetuals on Anchor</span>
          </div>
        </div>
        <div className="wallet-area">
          <WalletIcon size={16} />
          {mounted ? <WalletMultiButton /> : <button className="wallet-placeholder">Select Wallet</button>}
        </div>
      </header>

      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Live protocol surface</span>
          <h1>Anchor transactions are wired into the wallet.</h1>
          <p>
            The app can initialize the market, open a SOL-margined position, add margin, close the
            position, and refresh on-chain state. Pyth price updates are posted as pre-instructions
            before trade actions.
          </p>
        </div>
        <div className="status-card">
          <span className={programDeployed ? "status-pill" : "status-pill warning"}>
            {programDeployed === null ? "Checking deployment" : programDeployed ? "Program deployed" : "Program not found"}
          </span>
          <dl>
            <div>
              <dt>Cluster</dt>
              <dd>Devnet</dd>
            </div>
            <div>
              <dt>Program</dt>
              <dd>{PROGRAM_ID}</dd>
            </div>
            <div>
              <dt>Oracle feed</dt>
              <dd>{SOL_USD_FEED_ID}</dd>
            </div>
          </dl>
        </div>
      </section>

      {programDeployed === false ? (
        <section className="notice danger">
          <Shield size={18} />
          <span>
            The program account is not deployed on devnet yet. Deploy this program ID first, then
            refresh the page before sending market transactions.
          </span>
        </section>
      ) : null}

      <section className="content-grid">
        <section className="trade-card">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Trading</span>
              <h2>Trade position</h2>
            </div>
            <span className="mode-chip">Wallet transaction</span>
          </div>

          <div className="side-toggle" aria-label="Position direction">
            <button className={direction === "long" ? "active long" : ""} onClick={() => setDirection("long")}>
              Long
            </button>
            <button className={direction === "short" ? "active short" : ""} onClick={() => setDirection("short")}>
              Short
            </button>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Margin</span>
              <div className="input-wrap">
                <input
                  inputMode="decimal"
                  min="0"
                  onChange={(event) => setMargin(event.target.value)}
                  type="number"
                  value={margin}
                />
                <b>SOL</b>
              </div>
            </label>
            <label className="field">
              <span>Leverage: {leverage}x</span>
              <input
                className="range"
                max={MAX_LEVERAGE}
                min="1"
                onChange={(event) => setLeverage(Number(event.target.value))}
                type="range"
                value={leverage}
              />
            </label>
          </div>

          <div className="preview-grid">
            <Metric label="Mark price" value={`$${preview.mark}`} />
            <Metric label="Notional" value={`$${preview.notional}`} />
            <Metric label="Position size" value={preview.ready ? `${preview.size} SOL` : preview.size} />
            <Metric label="Entry price" value={preview.ready ? `$${preview.entry}` : preview.entry} />
            <Metric label="Est. liquidation" value={preview.ready ? `$${preview.liquidation}` : preview.liquidation} />
            <Metric label="Open fee" value={`${preview.feeSol} SOL`} />
          </div>

          <div className="action-grid">
            <button
              className="secondary-action"
              disabled={!canInitialize}
              onClick={() => runTransaction("Initialize market", () => sdk!.initializeMarket())}
            >
              Initialize Market
            </button>
            <button
              className={`primary-action ${direction}`}
              disabled={!canOpen}
              onClick={() => runTransaction(tradeLabel, () => sdk!.openPosition(direction, Number(margin), leverage))}
            >
              {tradeLabel}
            </button>
          </div>

          <div className="manage-panel">
            <div className="section-heading compact">
              <div>
                <span className="eyebrow">Manage position</span>
                <h2>Add margin or close</h2>
              </div>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Additional margin</span>
                <div className="input-wrap">
                  <input
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => setAddMargin(event.target.value)}
                    type="number"
                    value={addMargin}
                  />
                  <b>SOL</b>
                </div>
              </label>
              <div className="split-actions">
                <button
                  className="secondary-action"
                  disabled={!canAddMargin}
                  onClick={() => runTransaction("Add margin", () => sdk!.addMargin(Number(addMargin)))}
                >
                  Add Margin
                </button>
                <button
                  className="danger-action"
                  disabled={!canClose}
                  onClick={() => runTransaction("Close position", () => sdk!.closePosition())}
                >
                  Close Position
                </button>
              </div>
            </div>
          </div>

          <ActionStatus state={actionState} />
        </section>

        <aside className="summary-stack">
          <section className="info-card">
            <div className="section-heading compact">
              <div>
                <span className="eyebrow">On-chain state</span>
                <h2>Market</h2>
              </div>
              <button className="icon-action" disabled={isRefreshing} onClick={() => void refreshState()} aria-label="Refresh state">
                <RefreshCw size={18} />
              </button>
            </div>
            {market ? (
              <div className="state-grid">
                <Metric label="Mark price" value={`$${market.markPrice}`} />
                <Metric label="Open interest" value={`$${market.openInterest}`} />
                <Metric label="Total margin" value={`${market.totalMarginSol} SOL`} />
                <Metric label="Fee pool" value={`${market.feePoolSol} SOL`} />
                <Metric label="Paused" value={market.paused ? "Yes" : "No"} />
                <Metric label="Authority" value={shorten(market.authority)} />
              </div>
            ) : (
              <p className="empty-copy">No initialized market account found for this program ID.</p>
            )}
          </section>

          <section className="info-card">
            <div className="section-heading compact">
              <div>
                <span className="eyebrow">Wallet state</span>
                <h2>Position</h2>
              </div>
              <Database size={20} />
            </div>
            {position ? (
              <div className="state-grid">
                <Metric label="Direction" value={position.direction} />
                <Metric label="Size" value={`${position.size} SOL`} />
                <Metric label="Notional" value={`$${position.notional}`} />
                <Metric label="Margin" value={`${position.marginSol} SOL`} />
                <Metric label="Entry" value={`$${position.entryPrice}`} />
                <Metric label="Liquidation" value={`$${position.liquidationPrice}`} />
              </div>
            ) : (
              <p className="empty-copy">No position PDA found for the connected wallet.</p>
            )}
          </section>
        </aside>
      </section>

      <section className="repo-strip">
        <div>
          <strong>Implemented instructions</strong>
          <span>{implementedInstructions.join(", ")}.</span>
        </div>
        <a href="https://explorer.solana.com/?cluster=devnet" rel="noreferrer" target="_blank">
          Devnet explorer <ExternalLink size={14} />
        </a>
      </section>

      <section className="repo-strip">
        <div>
          <strong>Program accounts</strong>
          <span>{programAccounts.join(", ")}.</span>
        </div>
        <Code2 size={18} />
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ActionStatus({ state }: { state: ActionState }) {
  return (
    <div className={`action-status ${state.status}`}>
      <CheckCircle2 size={18} />
      <div>
        <strong>{state.status === "pending" ? "Pending" : state.status === "error" ? "Action failed" : "Status"}</strong>
        <span>{state.message}</span>
        {state.signature ? (
          <a href={`https://explorer.solana.com/tx/${state.signature}?cluster=devnet`} target="_blank" rel="noreferrer">
            View transaction <ExternalLink size={13} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function toMarketSummary(account: unknown): MarketSummary {
  const value = account as Record<string, unknown>;
  return {
    authority: String(readField(value, "authority") ?? ""),
    markPrice: formatScaled(toBigIntValue(readField(value, "markPrice", "mark_price")), 2),
    openInterest: formatScaled(toBigIntValue(readField(value, "openInterest", "open_interest")), 2),
    totalMarginSol: lamportsToSol(toBigIntValue(readField(value, "totalMargin", "total_margin"))),
    feePoolSol: lamportsToSol(toBigIntValue(readField(value, "feePool", "fee_pool"))),
    paused: Boolean(readField(value, "paused")),
  };
}

function toPositionSummary(account: unknown): PositionSummary {
  const value = account as Record<string, unknown>;
  return {
    direction: formatDirection(readField(value, "direction")),
    size: formatScaled(toBigIntValue(readField(value, "size")), 4),
    notional: formatScaled(toBigIntValue(readField(value, "notional")), 2),
    marginSol: lamportsToSol(toBigIntValue(readField(value, "margin"))),
    entryPrice: formatScaled(toBigIntValue(readField(value, "entryPrice", "entry_price")), 2),
    liquidationPrice: formatScaled(toBigIntValue(readField(value, "liquidationPrice", "liquidation_price")), 2),
    leverage: String(readField(value, "leverage") ?? "-"),
  };
}

function readField(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (key in value) return value[key];
  }
  return undefined;
}

function toBigIntValue(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (value && typeof value === "object" && "toString" in value) return BigInt(value.toString());
  return 0n;
}

function lamportsToSol(lamports: bigint): string {
  const sign = lamports < 0n ? "-" : "";
  const abs = lamports < 0n ? -lamports : lamports;
  const whole = abs / LAMPORTS_PER_SOL;
  const fraction = (abs % LAMPORTS_PER_SOL).toString().padStart(9, "0").slice(0, 6);
  return `${sign}${whole.toString()}.${fraction}`;
}

function formatDirection(value: unknown): string {
  if (!value || typeof value !== "object") return "-";
  const key = Object.keys(value)[0];
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : "-";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function shorten(value: string): string {
  return value.length > 12 ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;
}
