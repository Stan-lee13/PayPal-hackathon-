import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import "./globals.css";

const serif = Newsreader({ subsets: ["latin", "latin-ext"], variable: "--font-newsreader", style: ["normal", "italic"], display: "swap" });
const sans = IBM_Plex_Sans({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Kept", template: "%s · Kept" },
  description: "Every payment is a promise. Kept makes sure it's kept.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F5F2EA" }, { media: "(prefers-color-scheme: dark)", color: "#121314" }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 btn btn-primary">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
