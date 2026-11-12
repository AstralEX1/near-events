import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Video · Nearvent",
  description: "Nearvent in 30 seconds: find an event, register with a USDC deposit, check in, get paid.",
};

export default function VideoPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Nearvent in 30 Seconds</h1>
      {/* Web copy of showcase/nearvent-showcase.mp4 (re-encoded to ~4.6 MB). */}
      <video
        className="w-full rounded-2xl border border-border bg-surface"
        src="/video/nearvent-showcase.mp4"
        poster="/video/nearvent-showcase.jpg"
        width={1920}
        height={1080}
        controls
        autoPlay
        playsInline
        preload="metadata"
      />
      <Link href="/demo" className="btn btn-primary">Try Demo</Link>
    </div>
  );
}
