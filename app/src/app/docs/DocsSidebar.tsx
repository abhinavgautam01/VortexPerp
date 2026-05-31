"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function DocsSidebar() {
  const pathname = usePathname();

  const links = [
    { title: "Introduction", items: [
      { name: "What is a vAMM?", href: "/docs" },
      { name: "Long vs. Short", href: "/docs/positions" },
      { name: "Margin & Leverage", href: "/docs/margin" },
    ]},
    { title: "Protocol Mechanics", items: [
      { name: "Liquidations", href: "/docs/liquidations" },
      { name: "Pyth Oracles", href: "/docs/oracles" },
    ]}
  ];

  return (
    <aside style={{ width: "260px", flexShrink: 0, padding: "32px 10px", borderRight: "1px solid var(--line)", position: "sticky", top: "73px", height: "calc(100vh - 73px)", overflowY: "auto" }}>
      <nav style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
        {links.map(section => (
          <div key={section.title}>
            <h4 style={{ color: "rgba(255, 255, 255, 0.85)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "16px", fontWeight: 700, paddingLeft: "10px" }}>
              {section.title}
            </h4>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
              {section.items.map(link => {
                const isActive = pathname === link.href;
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      style={{
                        display: "block",
                        padding: "4px 10px",
                        color: isActive ? "var(--text)" : "var(--muted)",
                        textDecoration: "none",
                        fontSize: isActive ? "16px" : "15px",
                        fontWeight: isActive ? 600 : 400,
                        transition: "all 0.2s ease"
                      }}
                      onMouseOver={e => !isActive && (e.currentTarget.style.color = "var(--text)")}
                      onMouseOut={e => !isActive && (e.currentTarget.style.color = "var(--muted)")}
                    >
                      {link.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
