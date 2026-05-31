import Link from "next/link";
import DocsSidebar from "./DocsSidebar";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Navbar */}
      <header className="app-header" style={{ position: "sticky", top: 0, zIndex: 50, background: "var(--background)", borderBottom: "1px solid var(--line)", paddingLeft: "34px", paddingRight: "34px", paddingTop: "20px" }}>
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span className="brand-icon">
              <svg className="vortex-logo-svg" viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 5L12 19L20 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M7 8L12 16.5L17 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
                <path d="M10 11L12 14L14 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
              </svg>
            </span>
            <div>
              <strong>VortexPerp</strong>
              <span>Documentation</span>
            </div>
          </div>
        </div>
        <nav className="header-nav" style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <Link href="/" className="nav-link" style={{ color: 'var(--text)', textDecoration: 'none', fontWeight: 500 }}>
            ← Back to App
          </Link>
        </nav>
      </header>

      {/* Docs Layout */}
      <div style={{ display: "flex", flex: 1, maxWidth: "1200px", margin: "0 auto", width: "100%" }}>
        <DocsSidebar />
        <main style={{ flex: 1, padding: "48px 64px", color: "var(--text)", lineHeight: "1.7", fontSize: "16px" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
