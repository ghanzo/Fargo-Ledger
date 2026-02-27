import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack is the default bundler in Next.js 16.
  // ExcelJS ships a browser-compatible build (dist/es5/browser.js) that
  // Turbopack picks up automatically via the package.json "browser" field —
  // no manual Node.js polyfill config needed.
  turbopack: {},
};

export default nextConfig;
