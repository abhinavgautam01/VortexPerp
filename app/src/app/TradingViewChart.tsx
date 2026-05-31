"use client";

import React, { useEffect, useRef, memo } from 'react';

declare global {
  interface Window {
    TradingView: any;
  }
}

function TradingViewChart() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Only load the script if it hasn't been loaded already
    if (!document.getElementById("tradingview-widget-script")) {
      const script = document.createElement("script");
      script.id = "tradingview-widget-script";
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = () => initWidget();
      document.head.appendChild(script);
    } else {
      initWidget();
    }

    function initWidget() {
      if (typeof window !== "undefined" && window.TradingView && container.current) {
        // Clear container before initializing to prevent duplicates during React StrictMode
        container.current.innerHTML = '';
        
        new window.TradingView.widget({
          autosize: true,
          symbol: "BINANCE:SOLUSD",
          interval: "W",
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          enable_publishing: false,
          backgroundColor: "#070709", // Matches our app's bg
          gridColor: "#202028", // Matches our app's --line
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          container_id: container.current.id,
          toolbar_bg: "#070709",
          studies: [
            "Volume@tv-basicstudies"
          ]
        });
      }
    }
  }, []);

  return (
    <div style={{ width: "100%", background: "var(--surface)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: "24px" }}>
          <button style={{ background: "var(--surface-3)", color: "white", padding: "6px 16px", borderRadius: "8px", border: "none", cursor: "pointer", fontWeight: 600, fontSize: "14px", transition: "background 0.2s" }}>Chart</button>
        </div>
      </div>
      <div style={{ height: "500px", width: "100%" }}>
        <div id="tv_chart_container" ref={container} style={{ height: "100%", width: "100%" }} />
      </div>
    </div>
  );
}

export default memo(TradingViewChart);
