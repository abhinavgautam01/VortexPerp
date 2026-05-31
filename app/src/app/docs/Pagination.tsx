"use client";

import Link from "next/link";

interface PaginationProps {
  prev?: { name: string; href: string };
  next?: { name: string; href: string };
}

export default function DocsPagination({ prev, next }: PaginationProps) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: "32px", marginTop: "64px" }}>
      {prev ? (
        <Link
          href={prev.href}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "16px 24px",
            border: "1px solid var(--line)",
            borderRadius: "8px",
            textDecoration: "none",
            minWidth: "160px",
            background: "var(--surface)",
            transition: "all 0.2s ease"
          }}
          onMouseOver={e => e.currentTarget.style.borderColor = "var(--text)"}
          onMouseOut={e => e.currentTarget.style.borderColor = "var(--line)"}
        >
          <span style={{ fontSize: "12px", color: "var(--muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>← Previous</span>
          <span style={{ fontSize: "16px", color: "var(--text)", fontWeight: 500 }}>{prev.name}</span>
        </Link>
      ) : <div />}
      
      {next ? (
        <Link
          href={next.href}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "16px 24px",
            border: "1px solid var(--line)",
            borderRadius: "8px",
            textDecoration: "none",
            minWidth: "160px",
            alignItems: "flex-end",
            background: "var(--surface)",
            transition: "all 0.2s ease"
          }}
          onMouseOver={e => e.currentTarget.style.borderColor = "var(--text)"}
          onMouseOut={e => e.currentTarget.style.borderColor = "var(--line)"}
        >
          <span style={{ fontSize: "12px", color: "var(--muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>Next →</span>
          <span style={{ fontSize: "16px", color: "var(--text)", fontWeight: 500 }}>{next.name}</span>
        </Link>
      ) : <div />}
    </div>
  );
}
