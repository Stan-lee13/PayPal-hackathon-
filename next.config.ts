import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["postgres"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  webpack(config, { isServer, webpack }) {
    // Migration files are read as text by the in-browser database (lib/local/pg-worker.ts).
    config.module.rules.push({ test: /\.sql$/, type: "asset/source" });
    if (!isServer) {
      // PGlite carries Node-only branches it never takes in a browser; give the bundler empty modules for them.
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:/, (res: { request: string }) => { res.request = res.request.replace(/^node:/, ""); }));
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, "fs/promises": false, path: false, module: false, url: false, crypto: false, stream: false, zlib: false, os: false, util: false, worker_threads: false, child_process: false, async_hooks: false, net: false, tls: false, perf_hooks: false };
      // In the browser the gateway's database is PGlite, not a Postgres connection.
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^\.\/driver$/, (res: { context: string; request: string }) => {
        if (/[\\/]lib[\\/]db$/.test(res.context)) res.request = "./driver.browser";
      }));
    }
    return config;
  },
};

export default nextConfig;
