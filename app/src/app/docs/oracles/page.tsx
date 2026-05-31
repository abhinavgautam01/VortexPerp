import DocsPagination from "../Pagination";

export default function OraclesPage() {
  return (
    <div className="animate-in">
      <div style={{ marginBottom: "56px" }}>
        <h1 style={{ fontSize: "40px", marginBottom: "20px", color: "var(--text)", fontWeight: 700, letterSpacing: "-0.02em" }}>
          Pyth Network Oracles
        </h1>
        <p style={{ fontSize: "18px", color: "var(--muted)" }}>
          How VortexPerp guarantees accurate, manipulation-resistant pricing using Pyth.
        </p>
      </div>

      <section style={{ marginBottom: "48px" }}>
        <h2 style={{ fontSize: "24px", marginBottom: "16px", color: "var(--text)", fontWeight: 600 }}>The Oracle Problem</h2>
        <p style={{ marginBottom: "16px", color: "var(--text)" }}>
          A perpetual futures protocol must know the real-time, global price of an asset (like SOL/USD) to accurately calculate PNL (Profit & Loss) and process liquidations. If a single bad actor manipulates the price on one exchange, a naive protocol might use that manipulated price to liquidate honest users.
        </p>
        <p style={{ color: "var(--muted)" }}>
          To solve this, VortexPerp integrates deeply with the <strong>Pyth Network</strong>, an industry-leading decentralized financial oracle.
        </p>
      </section>

      <section style={{ marginBottom: "56px" }}>
        <h2 style={{ fontSize: "24px", marginBottom: "16px", color: "var(--text)", fontWeight: 600 }}>How it Works</h2>
        <div style={{ background: "rgba(0, 210, 255, 0.05)", padding: "24px", borderRadius: "8px", border: "1px solid rgba(0, 210, 255, 0.2)", borderLeft: "3px solid var(--cyan)", marginBottom: "24px" }}>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Pyth aggregates data from dozens of top-tier institutional exchanges and market makers simultaneously. It calculates a volume-weighted median price, which completely filters out flash crashes or manipulation occurring on any single exchange.
          </p>
        </div>
        <p style={{ color: "var(--text)", marginBottom: "16px" }}>
          Before any trade is executed on-chain, the latest cryptographically signed live price from Pyth is passed into the VortexPerp smart contract. This guarantees that:
        </p>
        <ul style={{ paddingLeft: "20px", color: "var(--muted)", display: "flex", flexDirection: "column", gap: "8px", margin: 0 }}>
          <li>Your PNL is based on the true global market price.</li>
          <li>Liquidations only happen when the global market moves, not when a single localized flash crash happens.</li>
          <li>The protocol is safe from oracle manipulation exploits.</li>
        </ul>
      </section>

      <DocsPagination 
        prev={{ name: "Liquidations", href: "/docs/liquidations" }}
      />
    </div>
  );
}
