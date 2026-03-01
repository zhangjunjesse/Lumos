# Complete File Changes for CodePilot → Lumos Migration

This document lists every file that needs to be modified, with exact changes required.

---

## Core Files (Critical Path)

### 1. `src/lib/db/connection.ts`

**Changes:**
1. Add `getDataDir()` helper function
2. Update `dataDir` export to use new function
3. Change `DB_PATH` from `codepilot.db` to `lumos.db`
4. Add `migrateFromCodePilot()` function
5. Call migration in `getDb()` before opening database
6. Update old paths array to include `.codepilot` locations

**Lines to change:**
- Line 7: `export const dataDir = ...` → Use `getDataDir()` function
- Line 8: `'codepilot.db'` → `'lumos.db'`
- Lines 19-44: Update migration logic to call `migrateFromCodePilot()`

**Estimated LOC:** +60 lines (new functions), ~5 lines modified

---

### 2. `src/lib/platform.ts`

**Changes:**
1. Add `getLumosDataDir()` function
2. Update `getClaudeConfigDir()` to check `LUMOS_CLAUDE_CONFIG_DIR` first
3. Add deprecation warnings for old env vars

**Lines to change:**
- Line 17-19: Update `getClaudeConfigDir()` function
- Add new function after line 19: `getLumosDataDir()`

**Estimated LOC:** +25 lines

---

### 3. `electron/main.ts`

**Changes:**
1. Update `initDefaultApiKey()` to check `LUMOS_DEFAULT_KEY` first
2. Add deprecation warning for `CODEPILOT_DEFAULT_KEY`
3. Update comments referencing CodePilot

**Lines to change:**
- Line 46: Comment mentions `CODEPILOT_DEFAULT_KEY`
- Line 61: `process.env.CODEPILOT_DEFAULT_KEY` → Add fallback logic

**Estimated LOC:** +5 lines modified

---

### 4. `src/lib/claude-client.ts`

**Changes:**
1. Update comments referencing `CODEPILOT_CLAUDE_CONFIG_DIR`
2. No functional changes (uses `getClaudeConfigDir()` from platform.ts)

**Lines to change:**
- Comments only

**Estimated LOC:** ~3 lines modified

---

## Configuration Files

### 5. `package.json`

**Changes:**
1. Update `electron:dev` script env vars
2. Update description if it mentions CodePilot

**Lines to change:**
- Line 16: `CODEPILOT_CLAUDE_CONFIG_DIR` → `LUMOS_CLAUDE_CONFIG_DIR`
- Line 16: `CLAUDE_GUI_DATA_DIR` → `LUMOS_DATA_DIR`

**Before:**
```json
"electron:dev": "cross-env CODEPILOT_CLAUDE_CONFIG_DIR=$HOME/.codepilot/.claude CLAUDE_GUI_DATA_DIR=$HOME/.codepilot concurrently -k \"next dev\" \"wait-on http://localhost:3000 && electron .\""
```

**After:**
```json
"electron:dev": "cross-env LUMOS_CLAUDE_CONFIG_DIR=$HOME/.lumos/.claude LUMOS_DATA_DIR=$HOME/.lumos concurrently -k \"next dev\" \"wait-on http://localhost:3000 && electron .\""
```

**Estimated LOC:** 2 lines modified

---

### 6. `dev.sh`

**Changes:**
1. Update environment variables
2. Update comments

**Before:**
```bash
export CODEPILOT_CLAUDE_CONFIG_DIR="$HOME/.codepilot/.claude"
export CLAUDE_GUI_DATA_DIR="$HOME/.codepilot"
```

**After:**
```bash
export LUMOS_CLAUDE_CONFIG_DIR="$HOME/.lumos/.claude"
export LUMOS_DATA_DIR="$HOME/.lumos"
```

**Estimated LOC:** 2 lines modified

---

### 7. `.gitignore`

**Changes:**
1. Update `.codepilot-uploads/` to `.lumos-uploads/` or remove (if moved to data dir)

**Line to change:**
- Line 55: `.codepilot-uploads/` → `.lumos-uploads/` or remove

**Estimated LOC:** 1 line modified

---

## UI Components

### 8. `src/components/chat/CodePilotLogo.tsx`

**Changes:**
1. Rename file to `LumosLogo.tsx`
2. Update component name
3. Update SVG id attributes

**Before:**
```typescript
export function CodePilotLogo({ className }: CodePilotLogoProps) {
  return (
    <svg ...>
      <g id="codepilot-cube">
```

**After:**
```typescript
export function LumosLogo({ className }: LumosLogoProps) {
  return (
    <svg ...>
      <g id="lumos-cube">
```

**Estimated LOC:** 5 lines modified

---

### 9. All files importing `CodePilotLogo`

**Files to update:**
- `src/components/layout/app-layout.tsx`
- `src/components/layout/AppShell.tsx`
- `src/app/chat/[id]/page.tsx`
- `src/components/layout/ChatListPanel.tsx`
- `src/app/chat/page.tsx`
- Any other files importing the logo

**Change:**
```typescript
// Before
import { CodePilotLogo } from '@/components/chat/CodePilotLogo';
<CodePilotLogo className="..." />

// After
import { LumosLogo } from '@/components/chat/LumosLogo';
<LumosLogo className="..." />
```

**Estimated LOC:** ~2 lines per file × 5 files = 10 lines

---

## Internationalization

### 10. `src/i18n/en.ts`

**Changes:**
1. Update strings mentioning "CodePilot"

**Lines to change:**
- Line 81: `'settings.description': 'Manage CodePilot and Claude CLI settings'`
- Line 85: `'settings.codepilot': 'CodePilot'`
- Any other user-facing strings

**Before:**
```typescript
'settings.description': 'Manage CodePilot and Claude CLI settings',
'settings.codepilot': 'CodePilot',
```

**After:**
```typescript
'settings.description': 'Manage Lumos and Claude CLI settings',
'settings.lumos': 'Lumos',
```

**Estimated LOC:** ~5 lines modified

---

### 11. `src/i18n/zh.ts`

**Changes:**
1. Update Chinese translations for CodePilot → Lumos

**Estimated LOC:** ~5 lines modified

---

## API Routes

### 12. `src/app/api/uploads/route.ts`

**Changes:**
1. Update upload directory path from `.codepilot-uploads` to use data dir

**Current logic:**
```typescript
const uploadDir = path.join(process.cwd(), '.codepilot-uploads');
```

**New logic:**
```typescript
import { getLumosDataDir } from '@/lib/platform';
const uploadDir = path.join(getLumosDataDir(), 'uploads');
```

**Estimated LOC:** 2 lines modified

---

### 13. `src/app/api/media/serve/route.ts`

**Changes:**
1. Update media serving path if it references `.codepilot-uploads`

**Estimated LOC:** 1-2 lines modified

---

### 14. `src/app/api/documents/upload/route.ts`

**Changes:**
1. Update upload path if it references `.codepilot-uploads`

**Estimated LOC:** 1-2 lines modified

---

## Settings & UI

### 15. `src/components/settings/GeneralSection.tsx`

**Changes:**
1. Update any UI text mentioning "CodePilot"
2. Update settings keys if they reference "codepilot"

**Estimated LOC:** ~3 lines modified

---

### 16. `src/components/workspace/workspace-picker.tsx`

**Changes:**
1. Update any references to `.codepilot` directory

**Estimated LOC:** 1-2 lines modified

---

## Documentation

### 17. `README.md`

**Changes:**
1. Update title from "CodePilot" to "Lumos"
2. Update all references throughout document
3. Update repository URLs
4. Update screenshot paths if needed
5. Update data directory paths in documentation

**Lines to change:**
- Line 1: Title
- Line 4: Description
- Line 6-8: Badge URLs
- Line 43: Prerequisites section
- Line 55: Download section
- Line 69: Clone command
- Line 235: Data storage path

**Estimated LOC:** ~20 lines modified

---

### 18. `README_CN.md`

**Changes:**
1. Same as README.md but for Chinese version

**Estimated LOC:** ~20 lines modified

---

### 19. `README_JA.md`

**Changes:**
1. Same as README.md but for Japanese version

**Estimated LOC:** ~20 lines modified

---

### 20. `CLAUDE.md`

**Changes:**
1. Update project references from CodePilot to Lumos
2. Update any directory paths mentioned

**Estimated LOC:** ~10 lines modified

---

## Test Files

### 21. `src/__tests__/unit/message-persistence.test.ts`

**Changes:**
1. Update test data paths if they reference `.codepilot`

**Estimated LOC:** 1-2 lines modified

---

### 22. `src/__tests__/unit/files-security.test.ts`

**Changes:**
1. Update security test paths

**Estimated LOC:** 1-2 lines modified

---

### 23. `src/__tests__/unit/db-shutdown.test.ts`

**Changes:**
1. Update database path tests

**Estimated LOC:** 1-2 lines modified

---

### 24. `src/__tests__/unit/claude-session-parser.test.ts`

**Changes:**
1. Update session path tests

**Estimated LOC:** 1-2 lines modified

---

## Build & CI

### 25. `.github/workflows/build.yml`

**Changes:**
1. Update any env vars in CI workflow
2. Update artifact names if they mention CodePilot

**Estimated LOC:** 2-5 lines modified

---

### 26. `scripts/after-pack.js`

**Changes:**
1. Update any comments or logs mentioning CodePilot

**Estimated LOC:** 1-2 lines modified

---

### 27. `scripts/build-electron.mjs`

**Changes:**
1. Update any comments or logs mentioning CodePilot

**Estimated LOC:** 1-2 lines modified

---

## MCP Server (Feishu)

### 28. `resources/feishu-mcp-server/services/auth.js`

**Changes:**
1. Update any references to CodePilot in comments or logs

**Estimated LOC:** 1-2 lines modified

---

## Summary Statistics

| Category | Files | Est. Lines Changed |
|----------|-------|-------------------|
| **Core Logic** | 4 | ~95 lines |
| **Configuration** | 3 | ~5 lines |
| **UI Components** | 6 | ~20 lines |
| **i18n** | 2 | ~10 lines |
| **API Routes** | 3 | ~6 lines |
| **Settings/UI** | 2 | ~5 lines |
| **Documentation** | 4 | ~50 lines |
| **Tests** | 4 | ~8 lines |
| **Build/CI** | 3 | ~8 lines |
| **MCP Server** | 1 | ~2 lines |
| **TOTAL** | **32 files** | **~209 lines** |

---

## Implementation Order

### Phase 1: Core Migration (Day 1)
1. `src/lib/platform.ts` - Add new functions
2. `src/lib/db/connection.ts` - Add migration logic
3. `electron/main.ts` - Update env var handling
4. Test migration thoroughly

### Phase 2: Configuration (Day 1)
5. `package.json` - Update scripts
6. `dev.sh` - Update env vars
7. `.gitignore` - Update paths

### Phase 3: UI & Components (Day 2)
8. `src/components/chat/CodePilotLogo.tsx` - Rename to LumosLogo
9. Update all imports of CodePilotLogo
10. `src/i18n/en.ts` - Update strings
11. `src/i18n/zh.ts` - Update strings

### Phase 4: API & Services (Day 2)
12. `src/app/api/uploads/route.ts` - Update paths
13. `src/app/api/media/serve/route.ts` - Update paths
14. `src/app/api/documents/upload/route.ts` - Update paths
15. `src/components/settings/GeneralSection.tsx` - Update UI

### Phase 5: Documentation (Day 3)
16. `README.md` - Complete rewrite
17. `README_CN.md` - Complete rewrite
18. `README_JA.md` - Complete rewrite
19. `CLAUDE.md` - Update references

### Phase 6: Tests & CI (Day 3)
20. Update all test files
21. `.github/workflows/build.yml` - Update CI
22. `scripts/after-pack.js` - Update scripts
23. `scripts/build-electron.mjs` - Update scripts

### Phase 7: Final Review (Day 4)
24. Run full test suite
25. Test on all platforms (macOS, Windows, Linux)
26. Test migration scenarios
27. Update release notes
28. Create migration guide

---

## Verification Checklist

After making all changes:

- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] `npm run electron:dev` works
- [ ] Migration from `.codepilot` to `.lumos` works
- [ ] Fresh install creates `.lumos` directory
- [ ] Old env vars still work (with warnings)
- [ ] New env vars work
- [ ] All tests pass
- [ ] macOS build succeeds
- [ ] Windows build succeeds
- [ ] Linux build succeeds
- [ ] Documentation is updated
- [ ] Release notes are written

---

## Estimated Timeline

- **Day 1**: Core migration + configuration (6-8 hours)
- **Day 2**: UI components + API routes (4-6 hours)
- **Day 3**: Documentation + tests + CI (4-6 hours)
- **Day 4**: Testing + verification + release prep (4-6 hours)

**Total**: 18-26 hours of development work

---

## Risk Mitigation

1. **Create feature branch**: `git checkout -b refactor/codepilot-to-lumos`
2. **Commit frequently**: One commit per file category
3. **Test incrementally**: Don't wait until the end
4. **Keep old code**: Don't delete backward compatibility until v0.23.0
5. **Document everything**: Update CLAUDE.md with migration notes

---

## Post-Migration Tasks

After v0.19.0 release:

1. Monitor GitHub issues for migration problems
2. Collect user feedback
3. Update documentation based on common questions
4. Plan deprecation timeline for v0.23.0
5. Consider adding cleanup utility to delete old `.codepilot` directory
