import type { NextConfig } from "next";

// Dev deployment: proxy the API through the web origin: /api/v1 (Next owns /api/webhooks) and the Google sign-in legs.
// On Vercel set NEXT_PUBLIC_API_URL="" so calls are same-origin and the refresh cookie is first-party.
const apiTarget = process.env.API_PROXY_TARGET?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    if (!apiTarget) return [];
    return [
      { source: "/api/v1/:path*", destination: `${apiTarget}/api/v1/:path*` },
      { source: "/oauth2/:path*", destination: `${apiTarget}/oauth2/:path*` },
      { source: "/login/oauth2/:path*", destination: `${apiTarget}/login/oauth2/:path*` },
    ];
  },
};

export default nextConfig;
