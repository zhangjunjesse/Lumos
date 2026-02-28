#!/bin/bash
# CodePilot dev mode — loads .env + injects sandbox env vars
set -e
cd "$(dirname "$0")"

# Load .env
set -a
source .env
set +a

# Sandbox isolation (in production, electron/main.ts handles these)
export CODEPILOT_CLAUDE_CONFIG_DIR="$HOME/.codepilot/.claude"
export CLAUDE_GUI_DATA_DIR="$HOME/.codepilot"
export CODEPILOT_DEFAULT_API_KEY="$CODEPILOT_DEFAULT_KEY"

open http://localhost:3000 &
npm run dev
