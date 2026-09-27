import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LIFEOS — Stop losing money to fine print", template: "%s · LIFEOS" },
  description:
    "Snap a receipt, forward an email, or type what you bought. LIFEOS finds every return window, warranty, free trial and credit, and reminds you before it costs you.",
  robots: { index: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
