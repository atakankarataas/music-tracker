import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { AppShell } from "@/components/app-shell";

import "./globals.css";

// Geist carries the interface: it has proper tabular numerals, which this
// dashboard leans on heavily for play counts and dates.
const geist = localFont({
  src: "./fonts/geist.ttf",
  weight: "100 900",
  display: "swap",
  variable: "--font-body",
});

// Bricolage Grotesque carries the headings — editorial and a little
// idiosyncratic, which suits a personal archive better than a neutral grotesk.
const bricolage = localFont({
  src: "./fonts/bricolage.ttf",
  weight: "200 800",
  display: "swap",
  variable: "--font-display",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://atakanfm.vercel.app"),
  title: { default: "atakan.fm", template: "%s · atakan.fm" },
  description: "A private record of a life in music.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#171717",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={`${geist.variable} ${bricolage.variable}`} lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
