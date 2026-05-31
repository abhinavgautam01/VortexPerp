import type { Metadata } from "next";
import { SolanaProvider } from "../components/solana-provider";
import { Toaster } from "sonner";
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
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
              fontFamily: "'Inter', sans-serif",
            },
            classNames: {
              toast: 'vortex-toast',
              title: 'vortex-toast-title',
              description: 'vortex-toast-description',
            }
          }}
        />
      </body>
    </html>
  );
}
