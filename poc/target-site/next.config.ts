import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      /* seeded: 2-hop redirect chain /old-gear -> /gear-old -> /products (manifest #16) */
      { source: "/old-gear", destination: "/gear-old", permanent: false },
      { source: "/gear-old", destination: "/products", permanent: false },
      /* seeded: redirect loop /loop-a <-> /loop-b (manifest #16) */
      { source: "/loop-a", destination: "/loop-b", permanent: false },
      { source: "/loop-b", destination: "/loop-a", permanent: false },
    ];
  },
};

export default nextConfig;
