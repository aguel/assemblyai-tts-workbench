import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// One family for the whole page. Next.js has no metric overrides for every face, so the
// size-adjusted fallback is turned off; the fallback is system-ui.
const sans = Geist({
  variable: "--nf-sans",
  subsets: ["latin", "latin-ext"],
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Text to Speech Workbench · Powered by AssemblyAI",
  description:
    "Type an announcement, pick one of eleven AssemblyAI voices and hear it streamed back, each word marked as it is spoken.",
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        {/* Hidden entrance states only apply when scripting works (see globals.css, motion). */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
