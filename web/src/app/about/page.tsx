import type { Metadata } from "next";
import { Suspense } from "react";
import { Header } from "@/components/Header";
import { PauseOnLeave } from "@/components/PauseOnLeave";

export const metadata: Metadata = { title: "Nearvent — Events people actually show up to." };

// The landing stays a static file (public/landing) with its own styles; the app header sits on top.
export default function AboutPage() {
  return (
    <div className="h-dvh flex flex-col">
      <Suspense fallback={<div className="h-[76px] border-b border-border" />}>
        <Header />
      </Suspense>
      <PauseOnLeave><iframe src="/landing/index.html" title="About Nearvent" className="flex-1 w-full border-0 block" /></PauseOnLeave>
    </div>
  );
}
