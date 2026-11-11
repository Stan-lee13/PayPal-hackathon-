import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { InkDefs } from "@/components/stationery";
import "./globals.css";

const display = Fraunces({ subsets: ["latin", "latin-ext"], style: ["normal", "italic"], axes: ["opsz", "SOFT"], variable: "--font-display", display: "swap" });
const ui = Instrument_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-ui", display: "swap" });
const data = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-data", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Envelope — give your agent an envelope, not your wallet", template: "%s · Envelope" },
  description: "Spending authority for AI agents, backed by a PayPal hold. An agent can split it for the agents it hires but never enlarge it, and anyone it wants to hire can check the money is really there.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F3EEE3" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${data.variable}`}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 btn btn-ink">Skip to content</a>
        <InkDefs />
        {children}
      </body>
    </html>
  );
}
