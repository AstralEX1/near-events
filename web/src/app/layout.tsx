import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Instrument_Serif, Nunito, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin", "cyrillic"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Fonts hosts can pick for their event page theme (see lib/theme.ts).
const inter = Inter({ variable: "--font-inter", subsets: ["latin", "cyrillic"] });
const grotesk = Space_Grotesk({ variable: "--font-grotesk", subsets: ["latin"] });
const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400" });
const rounded = Nunito({ variable: "--font-rounded", subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  title: "Near Events: show up, split the pool",
  description: "Commit a small USDC deposit to an event. Everyone who shows up splits the pool.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${grotesk.variable} ${serif.variable} ${rounded.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
