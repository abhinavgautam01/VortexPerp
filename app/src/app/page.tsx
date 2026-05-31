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
  TrendingDown,
  TrendingUp,
  Wallet as WalletIcon,
  Wifi,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import TradingViewChart from "./TradingViewChart";
import { useLivePrice } from "../hooks/use-live-price";
import idl from "../vortex_perp.json";
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
  baseAssetReserve: bigint;
  quoteAssetReserve: bigint;
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
  const livePrice = useLivePrice();

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
    const activeVammState = market ? {
      baseAssetReserve: market.baseAssetReserve,
      quoteAssetReserve: market.quoteAssetReserve,
      k: market.baseAssetReserve * market.quoteAssetReserve,
    } : {
      baseAssetReserve: 1_000_000n * SCALE,
      quoteAssetReserve: livePrice?.priceNum && livePrice.priceNum > 0
        ? BigInt(Math.floor(livePrice.priceNum * 1_000_000)) * SCALE
        : 20_000_000n * SCALE,
      k: 0n,
    };
    if (!market) {
      activeVammState.k = activeVammState.baseAssetReserve * activeVammState.quoteAssetReserve;
    }

    const marginSol = Number(margin || "0");
    const safeMarginSol = Number.isFinite(marginSol) && marginSol > 0 ? marginSol : 0;
    const marginLamports = BigInt(Math.round(safeMarginSol * Number(LAMPORTS_PER_SOL)));
    const indexPrice = markPrice(activeVammState);
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
        ? openLong(activeVammState, notional, marginLamports, indexPrice)
        : openShort(activeVammState, notional, marginLamports, indexPrice);

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
  }, [direction, margin, leverage, market, livePrice?.priceNum]);

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

  useEffect(() => {
    if (actionState.status === "idle") {
      let newMessage = "Connect a wallet to begin.";
      if (wallet.publicKey) {
        if (programDeployed === false) {
          newMessage = "Deploy the program before proceeding.";
        } else if (programDeployed === true && !market) {
          newMessage = "Initialize the market to start trading.";
        } else if (programDeployed === true && market) {
          newMessage = "System ready. Open a Long or Short position.";
        }
      }
      
      if (actionState.message !== newMessage) {
        setActionState(prev => ({ ...prev, message: newMessage }));
      }
    }
  }, [actionState.status, actionState.message, wallet.publicKey, programDeployed, market]);

  const runTransaction = async (label: string, execute: () => Promise<string>) => {
    if (!sdk || !wallet.publicKey) {
      toast.error("Connect a wallet first.");
      setActionState({ status: "error", message: "Connect a wallet first." });
      return;
    }

    setBusyAction(label);
    setActionState({ status: "pending", message: `${label} transaction is waiting for wallet approval.` });
    
    // Optional: show a loading toast if you want, but success/error is usually enough
    const toastId = toast.loading(`${label}...`);
    
    try {
      const signature = await execute();
      setActionState({
        status: "success",
        message: `${label} confirmed.`,
        signature,
      });
      toast.success(`${label} confirmed!`, { id: toastId });
      await refreshState();
    } catch (error) {
      setActionState({
        status: "error",
        message: toErrorMessage(error),
      });
      toast.error(toErrorMessage(error), { id: toastId });
    } finally {
      setBusyAction(null);
    }
  };

  const isWalletReady = Boolean(sdk && wallet.publicKey);
  const existingDirection = position?.direction.toLowerCase();
  
  let tradeLabel = "";
  if (!isWalletReady) {
    tradeLabel = "Connect Wallet";
  } else if (programDeployed === false) {
    tradeLabel = "Program Not Deployed";
  } else if (!market) {
    tradeLabel = "Market Not Initialized";
  } else if (!position) {
    tradeLabel = `Open ${direction === "long" ? "Long" : "Short"}`;
  } else {
    tradeLabel = existingDirection === direction
      ? `Increase ${direction === "long" ? "Long" : "Short"}`
      : `Reduce / Flip ${direction === "long" ? "Long" : "Short"}`;
  }

  const canInitialize = isWalletReady && programDeployed === true && !market && !busyAction;
  const canOpen = isWalletReady && programDeployed === true && Boolean(market) && preview.ready && !busyAction;
  const canClose = isWalletReady && programDeployed === true && Boolean(position) && !busyAction;
  const canAddMargin = canClose && Number(addMargin) > 0;

  return (
    <>
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
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
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
            <span>SOL isolated perpetuals</span>
          </div>
        </div>
        
        <div className="wallet-area" style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <nav className="header-nav" style={{ display: "flex", alignItems: "center", gap: "20px" }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              background: "rgba(0, 210, 255, 0.08)",
              border: "1px solid rgba(0, 210, 255, 0.2)",
              borderRadius: "6px",
              color: "var(--blue)",
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase"
            }}>
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--blue)", boxShadow: "0 0 8px var(--blue)" }} />
              Devnet
            </div>
            
            <a 
              href="https://faucet.solana.com/" 
              target="_blank" 
              rel="noreferrer"
              className="nav-link" 
              style={{
                color: "var(--muted)", 
                textDecoration: "none", 
                fontWeight: 600, 
                fontSize: "14px",
                transition: "color 0.2s"
              }}
              onMouseOver={e => e.currentTarget.style.color = "var(--text)"}
              onMouseOut={e => e.currentTarget.style.color = "var(--muted)"}
            >
              Airdrop
            </a>

            <Link 
              href="/docs" 
              className="nav-link" 
              style={{
                color: "var(--text)", 
                textDecoration: "none", 
                fontWeight: 600, 
                fontSize: "14px",
                transition: "color 0.2s"
              }}
              onMouseOver={e => e.currentTarget.style.color = "var(--green)"}
              onMouseOut={e => e.currentTarget.style.color = "var(--text)"}
            >
              Documentation
            </Link>
          </nav>
          
          <div style={{ display: "flex", alignItems: "center", gap: "12px", borderLeft: "1px solid var(--line)", paddingLeft: "24px" }}>
            <WalletIcon size={16} />
            {mounted ? <WalletMultiButton /> : <button className="wallet-placeholder">Select Wallet</button>}
          </div>
        </div>
      </header>

      <div className="live-ticker-strip">
        <div className="ticker-price-group">
          <span className="ticker-label">SOL / USD</span>
          <span className={`ticker-price ${livePrice.tickDirection}`}>
            ${livePrice.price}
          </span>
          {livePrice.tickDirection === "up" && <TrendingUp size={14} className="ticker-arrow up" />}
          {livePrice.tickDirection === "down" && <TrendingDown size={14} className="ticker-arrow down" />}
        </div>
        <div className="ticker-stats">
          <span className={`ticker-change ${livePrice.change24h >= 0 ? "positive" : "negative"}`}>
            {livePrice.change24h >= 0 ? "+" : ""}{livePrice.change24h.toFixed(2)}%
          </span>
          <span className="ticker-stat">
            <em>Funding</em> +0.0031% / 1h
          </span>
          <span className="ticker-stat">
            <em>H</em> ${livePrice.high24h}
          </span>
          <span className="ticker-stat">
            <em>L</em> ${livePrice.low24h}
          </span>
          <span className="ticker-stat">
            <em>Vol</em> {livePrice.volume24h}
          </span>
        </div>
        <span className={`ticker-connection ${livePrice.connected ? "online" : "offline"}`} title={livePrice.connected ? "Live feed connected" : "Feed disconnected"}>
          {livePrice.connected ? <Wifi size={12} /> : <WifiOff size={12} />}
          {livePrice.connected ? "Live" : "Offline"}
        </span>
      </div>

      <div style={{ marginBottom: "24px", borderRadius: "10px", overflow: "hidden", border: "1px solid var(--line)" }}>
        <TradingViewChart />
      </div>

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
            {!market && (
              <button
                className="secondary-action"
                disabled={!sdk || !wallet.publicKey}
                onClick={() => runTransaction("Initialize market", () => {
                  if (!livePrice || livePrice.priceNum <= 0) {
                    toast.error("Waiting for live price feed...");
                    return Promise.reject(new Error("Waiting for live price"));
                  }
                  const baseReserve = 1_000_000n * SCALE;
                  const quoteReserve = BigInt(Math.floor(livePrice.priceNum * 1_000_000)) * SCALE;
                  return sdk!.initializeMarket(baseReserve, quoteReserve);
                })}
              >
                Initialize Market
              </button>
            )}
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

      <section className="positions-panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Direction</th>
              <th>Size</th>
              <th>Notional</th>
              <th>Margin</th>
              <th>Entry Price</th>
              <th>Liq. Price</th>
              <th>Unrealized PnL</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {position ? (
              <tr>
                <td>SOL-PERP</td>
                <td className={position.direction === "Long" ? "positive" : "negative"}>
                  {position.direction}
                </td>
                <td>{position.size} SOL</td>
                <td>${position.notional}</td>
                <td>{position.marginSol} SOL</td>
                <td>${position.entryPrice}</td>
                <td>${position.liquidationPrice}</td>
                {/* Simulated PnL for demo purposes */}
                <td className={market && position.direction === "Long" && parseFloat(market.markPrice) > parseFloat(position.entryPrice) ? "positive" : "negative"}>
                  {market ? (
                    (() => {
                      const diff = parseFloat(market.markPrice) - parseFloat(position.entryPrice);
                      const pnl = position.direction === "Long" ? diff * parseFloat(position.size) : -diff * parseFloat(position.size);
                      return pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
                    })()
                  ) : "-"}
                </td>
                <td>
                  <button 
                    className="close-btn"
                    disabled={!canClose}
                    onClick={() => runTransaction("Close position", () => sdk!.closePosition())}
                  >
                    Close
                  </button>
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", padding: "48px", color: "var(--muted)" }}>
                  No open positions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="repo-strip">
        <div>
          <strong>Implemented instructions</strong>
          <span>{implementedInstructions.join(", ")}.</span>
        </div>
        <a href="https://solscan.io/account/72RTphkGMwRaxtmkBnyQ32NKox394craNKJcVABdKNo7?cluster=devnet#programIdl" rel="noreferrer" target="_blank">
          Devnet explorer <ExternalLink size={14} />
        </a>
      </section>


      </main>

      <footer className="brand-footer">
        <div className="brand-footer-text" data-text="VORTEXPERP">
          VORTEXPERP
        </div>
      </footer>
    </>
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
  const baseAssetReserve = toBigIntValue(readField(value, "baseAssetReserve", "base_asset_reserve"));
  const quoteAssetReserve = toBigIntValue(readField(value, "quoteAssetReserve", "quote_asset_reserve"));
  return {
    authority: String(readField(value, "authority") ?? ""),
    markPrice: formatScaled(toBigIntValue(readField(value, "markPrice", "mark_price")), 2),
    openInterest: formatScaled(toBigIntValue(readField(value, "openInterest", "open_interest")), 2),
    totalMarginSol: lamportsToSol(toBigIntValue(readField(value, "totalMargin", "total_margin"))),
    feePoolSol: lamportsToSol(toBigIntValue(readField(value, "feePool", "fee_pool"))),
    paused: Boolean(readField(value, "paused")),
    baseAssetReserve,
    quoteAssetReserve,
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
