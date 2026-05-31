"use client";

import { useEffect, useRef, useState } from "react";

export type LivePriceData = {
  /** Current price as a formatted string */
  price: string;
  /** Raw numeric price for comparisons */
  priceNum: number;
  /** 24h percentage change */
  change24h: number;
  /** 24h high */
  high24h: string;
  /** 24h low */
  low24h: string;
  /** 24h volume in SOL */
  volume24h: string;
  /** "up" | "down" | "neutral" based on last tick direction */
  tickDirection: "up" | "down" | "neutral";
  /** Whether the WebSocket is currently connected */
  connected: boolean;
};

const BINANCE_WS_URL = "wss://stream.binance.com:9443/ws/solusdt@ticker";
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Connects to Binance's real-time SOL/USDT ticker stream.
 * Provides price, 24h change, high/low, volume, and tick direction.
 * Automatically reconnects on disconnection.
 */
export function useLivePrice(): LivePriceData {
  const [data, setData] = useState<LivePriceData>({
    price: "—",
    priceNum: 0,
    change24h: 0,
    high24h: "—",
    low24h: "—",
    volume24h: "—",
    tickDirection: "neutral",
    connected: false,
  });

  const prevPriceRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let unmounted = false;

    function connect() {
      if (unmounted) return;

      const ws = new WebSocket(BINANCE_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted) { ws.close(); return; }
        reconnectAttemptsRef.current = 0;
        setData((prev) => ({ ...prev, connected: true }));
      };

      ws.onmessage = (event) => {
        if (unmounted) return;

        try {
          const msg = JSON.parse(event.data as string);
          const currentPrice = parseFloat(msg.c); // Current price
          const priceChange = parseFloat(msg.P); // 24h change %
          const high = parseFloat(msg.h);         // 24h high
          const low = parseFloat(msg.l);          // 24h low
          const volume = parseFloat(msg.v);       // 24h volume in SOL

          const prevPrice = prevPriceRef.current;
          let tickDirection: "up" | "down" | "neutral" = "neutral";
          if (prevPrice > 0) {
            if (currentPrice > prevPrice) tickDirection = "up";
            else if (currentPrice < prevPrice) tickDirection = "down";
          }
          prevPriceRef.current = currentPrice;

          setData({
            price: currentPrice.toFixed(2),
            priceNum: currentPrice,
            change24h: priceChange,
            high24h: high.toFixed(2),
            low24h: low.toFixed(2),
            volume24h: volume >= 1_000_000
              ? `${(volume / 1_000_000).toFixed(1)}M`
              : volume >= 1_000
                ? `${(volume / 1_000).toFixed(1)}K`
                : volume.toFixed(0),
            tickDirection,
            connected: true,
          });
        } catch {
          // Silently ignore malformed messages
        }
      };

      ws.onerror = () => {
        // Will trigger onclose
      };

      ws.onclose = () => {
        if (unmounted) return;
        setData((prev) => ({ ...prev, connected: false }));

        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current += 1;
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on intentional close
        wsRef.current.close();
      }
    };
  }, []);

  return data;
}
