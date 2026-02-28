import type { NextConfig } from "next";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', '@anthropic-ai/claude-agent-sdk'],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
