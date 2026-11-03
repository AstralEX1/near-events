import { Suspense, type ReactNode } from "react";
import { Instrument_Serif, Poppins } from "next/font/google";

// Fonts a host can pick to match its own site (?font=poppins&display=serif).
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["400", "500", "600"] });
const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400" });

// Embeds render bare: no header or footer, transparent around the card.
export default function EmbedLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${poppins.variable} ${serif.variable} embed-root`}>
      <Suspense fallback={null}>{children}</Suspense>
    </div>
  );
}
