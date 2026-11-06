import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Only the embed card may be framed by other sites. Everything else, including the
  // sign-up window where guests sign transactions, can't be (clickjacking).
  // Short payment link a host can paste anywhere (Luma description, Instagram, WhatsApp).
  async redirects() {
    return [{ source: "/p/:id", destination: "/embed/e/:id/join", permanent: false }];
  },
  // Landing page (approved artifact) is a static file in public/landing.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/landing/index.html" }] };
  },
  async headers() {
    return [
      { source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }] },
      { source: "/embed/e/:id", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] },
      { source: "/embed.js", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
    ];
  },
};

export default nextConfig;
