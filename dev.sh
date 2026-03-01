#!/bin/bash
# Lumos dev mode — loads .env + injects sandbox env vars
set -e
cd "$(dirname "$0")"

# Load .env
set -a
source .env
set +a

# Sandbox isolation (in production, electron/main.ts handles these)
export LUMOS_CLAUDE_CONFIG_DIR="$HOME/.lumos/.claude"
export LUMOS_DATA_DIR="$HOME/.lumos"
export LUMOS_DEFAULT_KEY="$CODEPILOT_DEFAULT_KEY"

open http://localhost:3000 &
npm run dev
