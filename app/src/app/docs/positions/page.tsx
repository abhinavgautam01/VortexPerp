import DocsPagination from "../Pagination";

export default function PositionsPage() {
  return (
    <div className="animate-in">
      <div style={{ marginBottom: "56px" }}>
        <h1 style={{ fontSize: "40px", marginBottom: "20px", color: "var(--text)", fontWeight: 700, letterSpacing: "-0.02em" }}>
          Long vs. Short Positions
        </h1>
        <p style={{ fontSize: "18px", color: "var(--muted)" }}>
          Perpetual futures allow you to bet on the price of an asset (like SOL) without actually owning it.
        </p>
      </div>

      <section style={{ marginBottom: "56px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <div style={{ background: "rgba(0, 255, 128, 0.05)", padding: "32px", borderRadius: "12px", border: "1px solid rgba(0, 255, 128, 0.2)" }}>
            <h3 style={{ color: "var(--green)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "10px", fontSize: "20px" }}>
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 10px var(--green)" }} /> 
              Going Long
            </h3>
            <p style={{ color: "var(--text)", fontSize: "15px", margin: 0, lineHeight: 1.6 }}>
              You believe the price of SOL will go <strong>UP</strong>. You lock in a buy price now to theoretically sell higher later. If the price rises above your entry point, your position becomes profitable.
            </p>
          </div>
          <div style={{ background: "rgba(255, 64, 129, 0.05)", padding: "32px", borderRadius: "12px", border: "1px solid rgba(255, 64, 129, 0.2)" }}>
            <h3 style={{ color: "var(--red)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "10px", fontSize: "20px" }}>
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "var(--red)", boxShadow: "0 0 10px var(--red)" }} /> 
              Going Short
            </h3>
            <p style={{ color: "var(--text)", fontSize: "15px", margin: 0, lineHeight: 1.6 }}>
              You believe the price of SOL will go <strong>DOWN</strong>. You lock in a sell price now to theoretically buy lower later. If the price falls below your entry point, your position becomes profitable.
            </p>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: "56px" }}>
        <h2 style={{ fontSize: "24px", marginBottom: "16px", color: "var(--text)", fontWeight: 600 }}>Example Trade</h2>
        <div style={{ background: "var(--surface-2)", padding: "24px", borderRadius: "8px", border: "1px solid var(--line)" }}>
          <ul style={{ margin: 0, paddingLeft: "20px", color: "var(--muted)", display: "flex", flexDirection: "column", gap: "12px" }}>
            <li>You open a <strong>10 SOL Long</strong> at an entry price of <strong>$150</strong>.</li>
            <li>The total size of your position is $1,500.</li>
            <li>Later, the price of SOL pumps to <strong>$160</strong>.</li>
            <li>Your position is now worth $1,600.</li>
            <li>You close the trade and instantly realize a pure profit of <strong>$100</strong>!</li>
          </ul>
        </div>
      </section>

      <DocsPagination 
        prev={{ name: "What is a vAMM?", href: "/docs" }}
        next={{ name: "Margin & Leverage", href: "/docs/margin" }}
      />
    </div>
  );
}
