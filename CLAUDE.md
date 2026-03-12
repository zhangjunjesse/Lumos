# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Lumos** is a desktop AI assistant built on Claude Code SDK, focused on document processing and knowledge management.

**Tech Stack**: Electron + Next.js 16 + React 19 + TypeScript + Tailwind CSS + shadcn/ui + better-sqlite3

**Core Features**:
1. Multi-model AI chat (Claude, OpenAI, custom APIs)
2. Feishu document integration (read, edit, image recognition)
3. MCP plugin system (extensible third-party services)
4. Session management and history
5. File attachments (images, documents)
6. Knowledge base RAG (planned)

---

## Development Commands

### Local Development
```bash
npm run dev                    # Next.js dev server only
npm run electron:dev           # Full Electron app with hot reload
npm run build                  # Build Next.js app
npm run lint                   # Run ESLint
```

### Building & Packaging
```bash
npm run electron:build         # Build for Electron (downloads Node.js & git-bash)
npm run electron:pack          # Build + package for current platform
npm run electron:pack:mac      # Package for macOS (DMG, universal binary)
npm run electron:pack:win      # Package for Windows (NSIS installer)
npm run electron:pack:linux    # Package for Linux (AppImage, deb, rpm)
```

### Native Module Handling
```bash
# After building Windows package on macOS, restore dev environment:
npm rebuild better-sqlite3

# Clean build artifacts:
rm -rf release/ .next/
```

---

## Architecture

### Key Components

**Frontend (Next.js + React)**
- `src/app/` - App Router pages (chat, settings)
- `src/components/` - React components organized by feature
- `src/lib/claude-client.ts` - Claude SDK wrapper with isolation logic
- `src/lib/db/` - SQLite database layer (sessions, providers, MCP configs)
- `src/lib/feishu/` - Feishu API integration

**Backend (Electron)**
- `electron/main.ts` - Main process entry point, handles window management and IPC
- Bundles Node.js runtime and git-bash (Windows) for Claude CLI

**Data Flow**
1. User interacts with Next.js frontend (localhost:3000 in dev, bundled in prod)
2. Frontend calls `/api/*` routes for business logic
3. API routes use `claude-client.ts` to invoke Claude SDK
4. SDK spawns isolated Claude CLI subprocess with custom config dir
5. Results stream back through API → Frontend → UI

---

## Data Storage

**User Data Directories**:
- Production: `~/.lumos/` (migrated from `~/.codepilot/`)
- Development: `~/.lumos-dev/`

**Directory Structure**:
```
~/.lumos/
├── lumos.db              # SQLite (sessions, providers, MCP configs)
├── .claude/              # Isolated Claude CLI config
├── sessions/             # Session data (JSONL history)
└── uploads/              # User uploaded files
```

**Database Tables**:
- `sessions` - Session metadata
- `api_providers` - AI Provider configs (supports is_builtin and user_modified fields)
- `mcp_servers` - MCP plugin configs

**Environment Variables**:
- Production: `LUMOS_DATA_DIR=~/.lumos`, `LUMOS_CLAUDE_CONFIG_DIR=~/.lumos/.claude`
- Development: `LUMOS_DATA_DIR=~/.lumos-dev`, `LUMOS_CLAUDE_CONFIG_DIR=~/.lumos-dev/.claude`
- Legacy vars (`CODEPILOT_*`, `CLAUDE_GUI_*`) auto-detected and migrated

---

## Claude CLI Isolation (Critical Architecture)

**Problem**: Lumos embeds Claude CLI. Without isolation, it inherits user's `~/.claude/` config, causing:
- API key conflicts
- MCP server conflicts
- Skills/Hooks pollution
- Uncontrollable configuration

**Solution**: Five-layer isolation

1. **Isolated Config Directory**: Use `~/.lumos/.claude/` instead of `~/.claude/`
   - Set via `LUMOS_CLAUDE_CONFIG_DIR` environment variable
   - Configured in: `electron/main.ts` line 312 (prod), `dev.sh` line 12 (dev)

2. **Environment Variable Isolation**: Clear all `CLAUDE_*` and `ANTHROPIC_*` vars before SDK startup
   - Only inject app config: API key, Base URL, `CLAUDE_CONFIG_DIR`
   - Implementation: `src/lib/claude-client.ts` lines 440-470

3. **SDK Setting Sources Isolation**: `settingSources: []` blocks SDK from reading:
   - `~/.claude/settings.json` (user global settings)
   - `~/.claude.json` (user MCP config)
   - `.claude/settings.json` (project settings)
   - All config must be injected via code
   - Implementation: `src/lib/claude-client.ts` line 523

4. **MCP Server Isolation**: Only load MCP servers configured in Lumos UI
   - User global MCP (`~/.claude.json`) not loaded
   - Built-in Feishu MCP bundled with app
   - Implementation: `src/app/api/plugins/mcp/route.ts`

5. **Skills/Hooks Isolation**: `settingSources: []` ensures user Skills/Hooks not loaded
   - App doesn't provide Skills/Hooks UI yet (future feature)
   - User's `~/.claude/skills/` completely ignored

**Verification**: Check logs after startup:
```
[main] Isolated Claude config directory exists: /path/to/.lumos/.claude
[claude-client] Isolation: using config dir: /path/to/.lumos/.claude
[claude-client] Sandbox: using bundled CLI: /path/to/cli.js
```

---

## Code Standards

**File Size Limits** (hard requirement):
- Max 300 lines per file
- Consider splitting at 200+ lines
- Single responsibility principle

**Naming Conventions**:
- Files: kebab-case (`feishu-client.ts`)
- Functions: camelCase (`getFeishuToken`)
- Constants: UPPER_SNAKE_CASE (`MAX_FILE_SIZE`)
- Classes/Components: PascalCase (`ChatMessage`)
- Types/Interfaces: PascalCase (`ApiProvider`)

**Module Organization**:
- Group related features in same directory
- Extract common code to `lib/` or `utils/`
- Keep API routes thin, delegate business logic to `lib/`
- Organize components by feature (`chat/`, `settings/`)

**Prohibited**:
- ❌ Files over 300 lines
- ❌ Functions over 50 lines
- ❌ Hard-coded configs (use env vars or database)
- ❌ Copy-paste code (extract common functions)
- ❌ Business logic in API routes (move to `lib/`)

---

## Git Workflow

**Commit Format**: Use Conventional Commits: `<type>: <description>`
- Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`
- Body: Explain what changed, why, and impact
- Bug fixes: Explain root cause, not just symptoms

**Auto-push**: When user requests commit, automatically `git push` after commit (no extra confirmation needed)

**Release Discipline**: Code commits proceed normally, but pushing tags requires explicit user instruction to "release" or "publish"

---

## Release Process

**Version Management**:
1. Update `version` in `package.json`
2. Run `npm install` to sync `package-lock.json`
3. Commit and push to `main` branch

**CI Auto-build**:
4. Create and push tag: `git tag v{version} && git push origin v{version}`
5. CI auto-triggers (`.github/workflows/build.yml`):
   - Parallel builds: macOS / Windows / Linux
   - Artifacts: DMG, exe, AppImage, deb, rpm
   - Auto-creates GitHub Release and uploads
6. Add release notes on Release page

**Notes**:
- Don't manually create GitHub Releases (conflicts with CI)
- Local test packaging: `npm run electron:pack:mac` (don't upload)
- Check CI status: `gh run list`
- Retry failed jobs: `gh run rerun <id> --failed`

**Build Artifacts**:
- macOS: DMG (arm64 + x64 universal)
- Windows: NSIS installer / zip
- Linux: AppImage, deb, rpm

**Native Module Handling**:
- `scripts/after-pack.js` recompiles `better-sqlite3` for Electron ABI during packaging
- Clean before build: `rm -rf release/ .next/`
- After building Windows on macOS: `npm rebuild better-sqlite3`

---

## Feishu Integration

**API Configuration**:
- Requires Feishu app `appId` and `appSecret`
- Documents must be authorized to the app for access
- `tenant_access_token` auto-cached, refreshed 5 minutes early

**Supported Features**:
- ✅ Read document content (text, tables, code blocks)
- ✅ Image recognition (download → base64 → send to Claude)
- ✅ Edit document blocks
- ✅ Append content to document end
- ❌ Feishu canvas (API unsupported, manually export as image)

---

## Development Guidelines

**Test Before Commit**:
- Thoroughly test all changed functionality, confirm no regressions
- UI changes: Actually start app to verify (`npm run dev` or `npm run electron:dev`)
- Build changes: Execute full packaging process to verify
- Multi-platform changes: Consider platform differences

**Research Before Implementation**:
- Research technical solutions, API compatibility, best practices
- Electron APIs: Confirm version support
- Third-party libraries: Confirm dependency compatibility
- Claude SDK: Confirm actually supported features
- Uncertain technical points: Do POC first, don't trial-and-error directly

---

## Known Issues & Solutions

**Database Path Migration**:
- Issue: Database not found after upgrading from CodePilot to Lumos
- Solution: App auto-detects `~/.codepilot/codepilot.db` and copies to `~/.lumos/lumos.db` on startup

**Feishu Canvas Unreadable**:
- Issue: Feishu canvas (block_type 43) only returns token, API doesn't support content retrieval
- Solution: Manually export as image then upload for recognition, or describe with text below canvas

**Claude CLI Session Management**:
- Issue: Each conversation is independent, no context
- Solution: Use `--continue` parameter to maintain session context

---

## Release Notes Format

**Title**: `Lumos v{version}`

**Required Sections**:
- **New Features** - List of new functionality
- **Bug Fixes** - Fixed issues
- **Downloads** - Installation packages for each platform
- **Installation** - Installation steps
- **Requirements** - System requirements
- **Changelog** - Commit list

