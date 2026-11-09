import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";

export const metadata: Metadata = {
  title: "Near Me — Events people actually show up to.",
  description: "Commit a small USDC deposit to an event. Everyone who shows up splits the pool.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href="/brand/fonts.css" />
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('near-me:appearance');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}` }} />
      </head>
      <body className="min-h-full flex flex-col">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
