import DocsPagination from "../Pagination";

export default function MarginPage() {
  return (
    <div className="animate-in">
      <div style={{ marginBottom: "56px" }}>
        <h1 style={{ fontSize: "40px", marginBottom: "20px", color: "var(--text)", fontWeight: 700, letterSpacing: "-0.02em" }}>
          Isolated Margin & Leverage
        </h1>
        <p style={{ fontSize: "18px", color: "var(--muted)" }}>
          VortexPerp uses an <strong>Isolated Margin</strong> system to keep your funds safe while offering powerful leverage.
        </p>
      </div>

      <section style={{ marginBottom: "48px" }}>
        <h2 style={{ fontSize: "24px", marginBottom: "16px", color: "var(--text)", fontWeight: 600 }}>What is Isolated Margin?</h2>
        <p style={{ marginBottom: "16px", color: "var(--text)" }}>
          Isolated margin means that each individual trade is strictly sandboxed. The only funds at risk are the exact SOL collateral you put into that specific position.
        </p>
        <p style={{ color: "var(--muted)" }}>
          For example, if you have 100 SOL in your wallet, and you open a trade with 1 SOL as margin, the absolute worst-case scenario is losing that 1 SOL. The other 99 SOL in your wallet are <strong>100% safe</strong>. The protocol can never reach into your wallet to cover a bad trade.
        </p>
      </section>

      <section style={{ marginBottom: "56px" }}>
        <h2 style={{ fontSize: "24px", marginBottom: "16px", color: "var(--text)", fontWeight: 600 }}>Using Leverage</h2>
        <p style={{ marginBottom: "16px", color: "var(--text)" }}>
          <strong>Leverage</strong> allows you to multiply your buying power, acting as a multiplier on your margin.
        </p>
        <div style={{ background: "rgba(0, 245, 160, 0.05)", padding: "24px", borderRadius: "8px", border: "1px solid rgba(0, 245, 160, 0.2)", borderLeft: "3px solid var(--cyan)" }}>
          <p style={{ margin: 0, color: "var(--text)" }}>
            If you have <strong>1 SOL</strong> of margin and use <strong>10x leverage</strong>, your position size becomes <strong>10 SOL</strong>.
          </p>
          <ul style={{ marginTop: "12px", marginBottom: 0, paddingLeft: "20px", color: "var(--muted)", display: "flex", flexDirection: "column", gap: "8px" }}>
            <li>If SOL goes up 5%, your 10 SOL position gains 0.5 SOL in value.</li>
            <li>Since you only put in 1 SOL, that 0.5 SOL gain represents a <strong>50% return on investment (ROI)</strong>!</li>
            <li><strong style={{ color: "var(--red)" }}>Warning:</strong> Leverage works both ways. If SOL drops 5%, you lose 50% of your margin.</li>
          </ul>
        </div>
      </section>

      <DocsPagination 
        prev={{ name: "Long vs. Short", href: "/docs/positions" }}
        next={{ name: "Liquidations", href: "/docs/liquidations" }}
      />
    </div>
  );
}
