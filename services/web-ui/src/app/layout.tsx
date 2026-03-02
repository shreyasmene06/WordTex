import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "WordTex — LaTeX ↔ Word ↔ PDF",
  description:
    "Enterprise-grade bidirectional document conversion with zero formatting loss.",
  keywords: ["LaTeX", "Word", "PDF", "document conversion", "academic"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className="font-sans min-h-screen"
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
