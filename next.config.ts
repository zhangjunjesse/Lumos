import type { NextConfig } from "next";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");
const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const customDistDir = process.env.LUMOS_NEXT_DIST_DIR?.trim();

const nextConfig: NextConfig = {
  output: 'standalone',
  ...(customDistDir ? { distDir: customDistDir } : {}),
  turbopack: {
    root: projectRoot,
  },
  outputFileTracingRoot: projectRoot,
  outputFileTracingIncludes: {
    '/*': [
      'node_modules/@huggingface/transformers/dist/transformers.web.js',
      'node_modules/onnxruntime-web/dist/**/*',
    ],
  },
  serverExternalPackages: [
    'better-sqlite3',
    '@anthropic-ai/claude-agent-sdk',
    '@node-rs/jieba',
    '@huggingface/transformers',
    '@openworkflow/backend-sqlite',
    'onnxruntime-node',
    'onnxruntime-web',
    'onnxruntime-common',
    'openworkflow',
  ],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.ignoreWarnings = [
        ...(config.ignoreWarnings || []),
        {
          module: /compiled-module-loader/,
          message: /Can't resolve '<dynamic>'/,
        },
      ];
    }
    return config;
  },
};

export default nextConfig;
