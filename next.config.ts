import type { NextConfig } from "next";

const production = process.env.NODE_ENV === "production";
const standalone = process.env.NEXT_OUTPUT_STANDALONE === "true";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${production ? "" : " ws: wss:"}`,
  "media-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  output: standalone ? "standalone" : undefined,
  outputFileTracingIncludes: {
    "/api/chat": ["./data/docs/**/*.md", "./data/docs-vectors.json"],
    "/api/health": ["./data/docs/**/*.md", "./data/docs-vectors.json"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Origin-Agent-Cluster", value: "?1" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          ...(production
            ? [{
                key: "Strict-Transport-Security",
                value: "max-age=31536000; includeSubDomains",
              }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
