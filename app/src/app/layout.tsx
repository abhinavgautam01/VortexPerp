import type { Metadata } from "next";
import { SolanaProvider } from "../components/solana-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "VortexPerp",
  description: "vAMM perpetual futures engine on Solana devnet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SolanaProvider>{children}</SolanaProvider>
      </body>
    </html>
  );
}
