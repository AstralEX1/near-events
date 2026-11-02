import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { Header } from "@/components/Header";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin", "cyrillic"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Near Events — show up, split the pool",
  description: "Commit a small USDC deposit to an event. Everyone who shows up splits the pool.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <WalletProvider>
          <Header />
          <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8">{children}</main>
          <footer className="text-center text-xs text-muted py-6">
            Near Events · deposits held by a NEAR smart contract · no platform fee
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
