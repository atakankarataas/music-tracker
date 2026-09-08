import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Every artwork URL points at Spotify's own CDN and is already delivered at
    // 300x300, which is larger than any slot in this UI but small enough that
    // the browser can scale it for free. Routing them through Vercel's image
    // optimizer would buy almost no bytes and would spend the Hobby plan's
    // source-image monthly allowance: a large archive can contain more distinct
    // covers than the plan allows, and Now Playing cycles through them too.
    // Serving them untouched keeps both the image quota and Vercel's egress
    // out of the picture entirely.
    unoptimized: true,
    // Retained so that re-enabling optimization stays a one-line change.
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "mosaic.scdn.co" },
      { protocol: "https", hostname: "seeded-session-images.scdn.co" },
    ],
  },
};

export default nextConfig;
