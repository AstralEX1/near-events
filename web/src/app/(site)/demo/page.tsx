"use client";

import { useEffect } from "react";
import { useWallet } from "@/lib/wallet";

// Shareable demo link: turns demo mode on in this browser and opens Explore.
export default function DemoPage() {
  const { signInWithDemo } = useWallet();
  useEffect(() => {
    void signInWithDemo("/events");
  }, [signInWithDemo]);
  return <p className="text-muted">Opening the demo…</p>;
}
