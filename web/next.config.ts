import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Only the embed card may be framed by other sites. Everything else, including the
  // sign-up window where guests sign transactions, can't be (clickjacking).
  // Short payment link a host can paste anywhere (Luma description, Instagram, WhatsApp).
  async redirects() {
    return [
      { source: "/p/:id", destination: "/embed/e/:id/join", permanent: false },
      // The site opens on the landing (/about); Explore is at /events.
      { source: "/", destination: "/about", permanent: false },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }] },
      { source: "/embed/e/:id", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] },
      { source: "/embed.js", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] },
      {
        source: "/landing/meetup/:file(balisquad-[a-z0-9-]+\\.[0-9a-f]{12}\\.mp4)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
