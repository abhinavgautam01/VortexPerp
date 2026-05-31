import DocsPagination from "../Pagination";

export default function LiquidationsPage() {
  return (
    <div className="animate-in">
      <div style={{ marginBottom: "56px" }}>
        <h1 style={{ fontSize: "40px", marginBottom: "20px", color: "var(--text)", fontWeight: 700, letterSpacing: "-0.02em" }}>
          Liquidations
        </h1>
        <p style={{ fontSize: "18px", color: "var(--muted)" }}>
          A liquidation occurs when the market moves heavily against your position, causing your collateral to become insufficient.
        </p>
      </div>

      <section style={{ marginBottom: "48px" }}>
        <h2 style={{ fontSize: "24px", marginBottom: "16px", color: "var(--text)", fontWeight: 600 }}>The Mechanics of Liquidation</h2>
        <p style={{ marginBottom: "16px", color: "var(--text)" }}>
          When you trade with leverage, you are borrowing synthetic buying power. To maintain the health of the protocol, your position must always be backed by a minimum percentage of margin, known as the <strong>Maintenance Margin Fraction</strong>.
        </p>
        <p style={{ marginBottom: "16px", color: "var(--text)" }}>
          If the price of SOL moves against you (e.g., you went Long but the price dropped), your position incurs <em>unrealized losses</em>. These losses are subtracted from your initial margin.
        </p>
        <div style={{ background: "rgba(255, 170, 0, 0.05)", padding: "24px", borderRadius: "8px", border: "1px solid rgba(255, 170, 0, 0.2)", borderLeft: "3px solid var(--yellow)" }}>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            If your remaining margin falls below the maintenance threshold, the smart contract will automatically <strong>liquidate</strong> your position. The position is closed at the current market price, and a portion of your remaining collateral is added to the Insurance Fund to protect the protocol against bad debt.
          </p>
        </div>
      </section>

      <section style={{ marginBottom: "56px" }}>
        <h2 style={{ fontSize: "24px", marginBottom: "16px", color: "var(--text)", fontWeight: 600 }}>Liquidation Example</h2>
        <div style={{ background: "var(--surface-2)", padding: "24px", borderRadius: "8px", border: "1px solid var(--line)" }}>
          <ul style={{ margin: 0, paddingLeft: "20px", color: "var(--muted)", display: "flex", flexDirection: "column", gap: "12px" }}>
            <li>You open a Long position with <strong>1 SOL margin</strong> at <strong>10x leverage</strong> (Position size: 10 SOL).</li>
            <li>SOL is currently at <strong>$150</strong>.</li>
            <li>If SOL drops by 10% to <strong>$135</strong>, your position loses 10% of its value (1 SOL loss).</li>
            <li>Since your initial margin was only 1 SOL, your margin is now totally depleted!</li>
            <li>To prevent the position from going negative (which would bankrupt the protocol), the protocol liquidates the position <em>before</em> it hits -10%. Watch your Est. Liq. Price closely!</li>
          </ul>
        </div>
      </section>

      <DocsPagination 
        prev={{ name: "Margin & Leverage", href: "/docs/margin" }}
        next={{ name: "Pyth Oracles", href: "/docs/oracles" }}
      />
    </div>
  );
}
