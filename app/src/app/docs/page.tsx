import { Database } from "lucide-react";
import DocsPagination from "./Pagination";

export default function DocsPage() {
  return (
    <div className="animate-in">
      <div style={{ marginBottom: "56px" }}>
        <h1 style={{ fontSize: "40px", marginBottom: "20px", color: "var(--text)", fontWeight: 700, letterSpacing: "-0.02em" }}>
          VortexPerp Documentation
        </h1>
        <p style={{ fontSize: "18px", color: "var(--muted)" }}>
          Welcome to the official documentation for VortexPerp. This guide explains the core concepts behind our Virtual Automated Market Maker (vAMM) perpetual futures protocol on Solana.
        </p>
      </div>

      <section id="vamm" style={{ marginBottom: "56px" }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "28px", marginBottom: "20px", color: "var(--text)", fontWeight: 600, borderBottom: "1px solid var(--line)", paddingBottom: "12px" }}>
          What is a vAMM?
        </h2>
        <p style={{ marginBottom: "16px" }}>
          A <strong>Virtual Automated Market Maker (vAMM)</strong> works like a standard decentralized exchange (like Uniswap), but with a twist: <strong>there are no actual tokens inside the liquidity pool!</strong>
        </p>
        <div style={{ background: "var(--surface-2)", padding: "24px", borderRadius: "8px", border: "1px solid var(--line)", borderLeft: "3px solid var(--cyan)", marginBottom: "16px" }}>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Instead of swapping real SOL for real USDC, the vAMM uses pure math <code style={{ background: "var(--background)", padding: "2px 6px", borderRadius: "4px", color: "var(--cyan)" }}>x * y = k</code> to calculate the price of a synthetic asset.
          </p>
        </div>
        <p>
          When you trade on VortexPerp, your collateral (SOL) is stored safely in a smart contract vault, and the vAMM simply tracks your "position" mathematically. This allows for infinite liquidity without needing liquidity providers!
        </p>
      </section>

      <DocsPagination 
        next={{ name: "Long vs. Short", href: "/docs/positions" }}
      />
    </div>
  );
}
