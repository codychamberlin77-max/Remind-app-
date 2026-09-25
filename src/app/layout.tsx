import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LIFEOS — Your life has too much admin", template: "%s · LIFEOS" },
  description:
    "Upload your receipts, documents, screenshots, and confirmations. We'll find the deadlines, warranties, subscriptions, credits, and tasks hiding inside them.",
  robots: { index: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fafaf9",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
