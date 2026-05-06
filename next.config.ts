import type { NextConfig } from "next";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");
const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const customDistDir = process.env.LUMOS_NEXT_DIST_DIR?.trim();

function resolveEdition(): 'open' | 'pro' {
  const raw = (
    process.env.NEXT_PUBLIC_LUMOS_EDITION
    ?? process.env.LUMOS_EDITION
    ?? 'open'
  ).trim().toLowerCase();
  return raw === 'pro' ? 'pro' : 'open';
}

function createConfig(phase: string): NextConfig {
  // Set real process.env so server-side code (connection.ts) can read it.
  // Next.js `env` config only does compile-time inlining for client bundles.
  if (phase === PHASE_PRODUCTION_BUILD) {
    process.env.LUMOS_BUILD_PHASE = '1';
  }
  const edition = resolveEdition();
  process.env.NEXT_PUBLIC_LUMOS_EDITION = edition;

  return {
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
        // Force-include onnxruntime-node's full bin tree — nft only auto-captures
        // the `.node` binding, missing the sibling `onnxruntime.dll` /
        // `DirectML.dll` (win) and `libonnxruntime.*.dylib` (mac) that the
        // binding LoadLibrarys at runtime. Absent those, Windows reports the
        // binding as "not a valid Win32 application" (misleading — actually a
        // dependency-chain failure).
        'node_modules/onnxruntime-node/bin/**/*',
      ],
    },
    outputFileTracingExcludes: {
      '/*': [
        // Stable desktop runtime resources are copied by electron-builder
        // extraResources. Letting Next trace them makes cross-platform builds
        // walk thousands of Windows runtime files and can exhaust Node heap.
        'resources/git-bash/**/*',
        'resources/node-runtime/**/*',
        'resources/python-runtime/**/*',
        'release/**/*',
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
      NEXT_PUBLIC_LUMOS_EDITION: edition,
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
}

export default createConfig;
