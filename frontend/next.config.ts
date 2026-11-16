import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// Owner (admin) API: a SEPARATE local process (backend/src/server-admin.ts) on a fixed loopback address. The browser never talks to it directly:
// it calls /api/admin/* on this site and Next forwards those requests server-side. That keeps the owner session cookie (HttpOnly,
// SameSite=Strict, Path=/api/admin) first-party, needs no CORS, and exposes no admin address or secret to the page.
// Development only: a deployed dashboard gets its own, separately approved, routing. The public booking API is not proxied here.
const ADMIN_API_ORIGIN = "http://127.0.0.1:8788";

// Private area: never cached, never framed, never indexed, no referrer.
const privateHeaders = [
  { key: "Cache-Control", value: "no-store" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/admin", headers: privateHeaders },
      { source: "/admin/:path*", headers: privateHeaders },
    ];
  },
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return [{ source: "/api/admin/:path*", destination: `${ADMIN_API_ORIGIN}/api/admin/:path*` }];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [60, 70, 75, 80],
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
