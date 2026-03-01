# CodePilot to Lumos Migration Plan

## Executive Summary

This document outlines the comprehensive strategy for renaming the project from **CodePilot** to **Lumos**, including data migration, backward compatibility, and implementation steps.

---

## Current State Analysis

### Package & Build Configuration
- ✅ `package.json`: Already named "lumos"
- ✅ `electron-builder.yml`: Already uses "Lumos" as productName and appId `com.lumos.app`
- ❌ Repository references still point to CodePilot

### Data Directories
- **Current**: `~/.codepilot/` (controlled by `CLAUDE_GUI_DATA_DIR`)
- **Database**: `~/.codepilot/codepilot.db`
- **Claude Config**: `~/.codepilot/.claude/` (controlled by `CODEPILOT_CLAUDE_CONFIG_DIR`)
- **Uploads**: `.codepilot-uploads/` (runtime directory)

### Environment Variables
- `CLAUDE_GUI_DATA_DIR` → Points to data directory
- `CODEPILOT_CLAUDE_CONFIG_DIR` → Points to Claude config directory
- `CODEPILOT_DEFAULT_KEY` → Default API key encryption

### Code References
Found 46 files with "codepilot" references:
- Database connection logic
- Claude client configuration
- Electron main process
- i18n translations
- Component names (CodePilotLogo)
- Documentation (README, CLAUDE.md)
- Dev scripts
- Test files

---

## Proposed Naming Convention

### 1. Data Directory Structure

**New Structure:**
```
~/.lumos/
├── lumos.db              # Main database (renamed from codepilot.db)
├── .claude/              # Claude CLI config (isolated per app)
└── uploads/              # User uploads (moved from .codepilot-uploads/)
```

**Rationale:**
- Clean break from old naming
- Consistent with package.json and electron-builder.yml
- Easier to communicate to users
- Aligns with product branding

### 2. Environment Variables

**New Variables:**
```bash
LUMOS_DATA_DIR              # Replaces CLAUDE_GUI_DATA_DIR
LUMOS_CLAUDE_CONFIG_DIR     # Replaces CODEPILOT_CLAUDE_CONFIG_DIR
LUMOS_DEFAULT_KEY           # Replaces CODEPILOT_DEFAULT_KEY
```

**Backward Compatibility (Phase 1 only):**
- Support both old and new variable names
- New names take precedence
- Log deprecation warnings for old names

### 3. Database Filename

**Decision:** Rename to `lumos.db`

**Rationale:**
- Consistent with project name
- Clear ownership
- Migration path already exists in code

---

## Migration Strategy

### Phase 1: Automatic Migration (v0.19.0)

**Goal:** Seamlessly migrate existing users without data loss

**Detection Logic:**
1. Check if `~/.lumos/lumos.db` exists → Use new location
2. If not, check if `~/.codepilot/codepilot.db` exists → Migrate
3. If neither exists → Fresh install, use new location

**Migration Steps:**
```typescript
function migrateFromCodePilot(): boolean {
  const oldDir = path.join(os.homedir(), '.codepilot');
  const newDir = path.join(os.homedir(), '.lumos');
  const oldDb = path.join(oldDir, 'codepilot.db');
  const newDb = path.join(newDir, 'lumos.db');

  // Skip if already migrated
  if (fs.existsSync(newDb)) return false;

  // Skip if no old installation
  if (!fs.existsSync(oldDb)) return false;

  console.log('[migration] Migrating from CodePilot to Lumos...');

  // Create new directory
  fs.mkdirSync(newDir, { recursive: true });

  // Copy database files (including WAL and SHM)
  fs.copyFileSync(oldDb, newDb);
  if (fs.existsSync(oldDb + '-wal')) {
    fs.copyFileSync(oldDb + '-wal', newDb + '-wal');
  }
  if (fs.existsSync(oldDb + '-shm')) {
    fs.copyFileSync(oldDb + '-shm', newDb + '-shm');
  }

  // Migrate Claude config directory
  const oldClaudeConfig = path.join(oldDir, '.claude');
  const newClaudeConfig = path.join(newDir, '.claude');
  if (fs.existsSync(oldClaudeConfig)) {
    fs.cpSync(oldClaudeConfig, newClaudeConfig, { recursive: true });
  }

  // Migrate uploads directory
  const oldUploads = path.join(process.cwd(), '.codepilot-uploads');
  const newUploads = path.join(newDir, 'uploads');
  if (fs.existsSync(oldUploads)) {
    fs.cpSync(oldUploads, newUploads, { recursive: true });
  }

  console.log('[migration] Migration complete. Old data preserved at:', oldDir);
  return true;
}
```

**User Communication:**
- Show one-time notification: "Welcome to Lumos! Your data has been migrated from CodePilot."
- Log migration details to console
- Keep old directory intact (don't delete)

### Phase 2: Deprecation Period (v0.19.0 - v0.22.0)

**Duration:** 3-4 releases (~2-3 months)

**Actions:**
- Support both old and new environment variable names
- Log deprecation warnings when old variables are used
- Update all documentation to use new names
- Add migration notice to release notes

**Deprecation Warning Example:**
```
[DEPRECATED] CODEPILOT_CLAUDE_CONFIG_DIR is deprecated and will be removed in v0.23.0.
Please use LUMOS_CLAUDE_CONFIG_DIR instead.
```

### Phase 3: Cleanup (v0.23.0+)

**Actions:**
- Remove support for old environment variables
- Remove backward compatibility code
- Optionally: Prompt users to delete old `~/.codepilot/` directory

---

## Implementation Plan

### Step 1: Core Migration Logic

**Files to modify:**

1. **`src/lib/db/connection.ts`**
   - Change default directory from `.lumos` to `.lumos`
   - Change database filename from `codepilot.db` to `lumos.db`
   - Add migration logic to copy from old location
   - Update old paths array to include `.codepilot` locations

2. **`src/lib/platform.ts`**
   - Add `getLumosDataDir()` function
   - Update `getClaudeConfigDir()` to check `LUMOS_CLAUDE_CONFIG_DIR` first
   - Add deprecation warnings for old env vars

3. **`electron/main.ts`**
   - Update `initDefaultApiKey()` to check `LUMOS_DEFAULT_KEY` first
   - Add migration trigger on app startup
   - Update userData path logic

### Step 2: Environment Variables

**Files to modify:**

1. **`package.json`**
   ```json
   "electron:dev": "cross-env LUMOS_CLAUDE_CONFIG_DIR=$HOME/.lumos/.claude LUMOS_DATA_DIR=$HOME/.lumos concurrently -k \"next dev\" \"wait-on http://localhost:3000 && electron .\""
   ```

2. **`dev.sh`**
   ```bash
   export LUMOS_DATA_DIR="$HOME/.lumos"
   export LUMOS_CLAUDE_CONFIG_DIR="$HOME/.lumos/.claude"
   ```

3. **`.gitignore`**
   ```
   # user uploads (runtime data)
   .lumos-uploads/
   ```

### Step 3: Component & UI Updates

**Files to modify:**

1. **`src/components/chat/CodePilotLogo.tsx`**
   - Rename to `LumosLogo.tsx`
   - Update component name and internal IDs
   - Update SVG id from `codepilot-cube` to `lumos-cube`

2. **`src/i18n/en.ts` & `src/i18n/zh.ts`**
   - Update `settings.description`: "Manage Lumos and Claude CLI settings"
   - Update `settings.codepilot`: "Lumos"
   - Update any other CodePilot references

3. **All component imports**
   - Update imports from `CodePilotLogo` to `LumosLogo`

### Step 4: Documentation Updates

**Files to modify:**

1. **`README.md`**
   - Update title and badges
   - Update repository URLs
   - Update data directory references
   - Update screenshots if they show "CodePilot" branding

2. **`README_CN.md` & `README_JA.md`**
   - Same updates as English README

3. **`CLAUDE.md`**
   - Update project name references
   - Update data directory paths

4. **`docs/` directory**
   - Update all documentation files
   - Add migration guide

### Step 5: Build & Release Configuration

**Files to modify:**

1. **`.github/workflows/build.yml`**
   - Update release notes template
   - Update artifact names if needed

2. **`scripts/after-pack.js`**
   - Update any hardcoded paths or references

### Step 6: API & Route Updates

**Files to check:**

1. **`src/app/api/uploads/route.ts`**
   - Update upload directory from `.codepilot-uploads` to `.lumos/uploads`

2. **`src/app/api/media/serve/route.ts`**
   - Update media serving paths

3. **`src/lib/feishu-auth.ts`**
   - Update any hardcoded paths

4. **`src/lib/image-generator.ts`**
   - Update any hardcoded paths

### Step 7: Test Updates

**Files to modify:**

1. All test files in `src/__tests__/`
   - Update test data paths
   - Update assertions
   - Update mock configurations

---

## Backward Compatibility Matrix

| Component | Old Name | New Name | Compatibility Period |
|-----------|----------|----------|---------------------|
| Data Directory | `~/.codepilot/` | `~/.lumos/` | Auto-migrate, keep old |
| Database File | `codepilot.db` | `lumos.db` | Auto-migrate |
| Env: Data Dir | `CLAUDE_GUI_DATA_DIR` | `LUMOS_DATA_DIR` | v0.19-v0.22 |
| Env: Claude Config | `CODEPILOT_CLAUDE_CONFIG_DIR` | `LUMOS_CLAUDE_CONFIG_DIR` | v0.19-v0.22 |
| Env: Default Key | `CODEPILOT_DEFAULT_KEY` | `LUMOS_DEFAULT_KEY` | v0.19-v0.22 |
| Uploads Dir | `.codepilot-uploads/` | `.lumos/uploads/` | Auto-migrate |

---

## Testing Strategy

### Pre-Migration Testing

1. **Fresh Install Test**
   - Install on clean system
   - Verify `~/.lumos/` is created
   - Verify `lumos.db` is created
   - Verify app functions normally

2. **Migration Test (from v0.18.0)**
   - Install v0.18.0 and create test data
   - Upgrade to v0.19.0
   - Verify data is migrated to `~/.lumos/`
   - Verify old data is preserved
   - Verify app functions with migrated data

3. **Environment Variable Test**
   - Test with old env vars → Should work with deprecation warning
   - Test with new env vars → Should work without warning
   - Test with both → New should take precedence

### Post-Migration Testing

1. **Session Management**
   - Create new sessions
   - Resume old sessions
   - Delete sessions
   - Import from CLI

2. **File Operations**
   - Upload files
   - Attach images
   - Verify file paths

3. **Settings**
   - Modify settings
   - Verify persistence
   - Check Claude CLI integration

### Platform-Specific Testing

- **macOS**: Test on Intel and Apple Silicon
- **Windows**: Test on x64 and arm64
- **Linux**: Test AppImage, deb, and rpm

---

## Rollback Plan

### If Migration Fails

1. **Automatic Rollback**
   ```typescript
   try {
     migrateFromCodePilot();
   } catch (err) {
     console.error('[migration] Failed:', err);
     // Fall back to old location
     return path.join(os.homedir(), '.codepilot');
   }
   ```

2. **Manual Rollback**
   - User can downgrade to v0.18.0
   - Old data is still intact at `~/.codepilot/`
   - No data loss

### If Critical Bug Found

1. **Hotfix Release**
   - Revert problematic changes
   - Release v0.19.1 with fix
   - Keep migration logic but fix the bug

2. **Communication**
   - GitHub issue with workaround
   - Release notes with fix details
   - Discord/community notification

---

## Release Notes Template (v0.19.0)

```markdown
# Lumos v0.19.0

## 🎉 CodePilot is now Lumos!

We've renamed the project to better reflect its vision as a comprehensive AI-powered development assistant.

### What's Changed

- **New Name**: CodePilot → Lumos
- **New Data Directory**: `~/.codepilot/` → `~/.lumos/`
- **New Database**: `codepilot.db` → `lumos.db`
- **Automatic Migration**: Your existing data will be automatically migrated on first launch

### Migration Details

When you launch v0.19.0 for the first time:
1. Your data will be automatically copied from `~/.codepilot/` to `~/.lumos/`
2. Your old data will be preserved (not deleted) for safety
3. You'll see a one-time notification confirming the migration

### Environment Variables (Deprecated)

The following environment variables are deprecated and will be removed in v0.23.0:
- `CLAUDE_GUI_DATA_DIR` → Use `LUMOS_DATA_DIR`
- `CODEPILOT_CLAUDE_CONFIG_DIR` → Use `LUMOS_CLAUDE_CONFIG_DIR`
- `CODEPILOT_DEFAULT_KEY` → Use `LUMOS_DEFAULT_KEY`

Old variables will continue to work with deprecation warnings until v0.23.0.

### Breaking Changes

None. This release is fully backward compatible.

### Bug Fixes

- Fixed migration logic for WAL mode databases
- Improved error handling during data migration

### Downloads

- macOS: `Lumos-0.19.0-arm64.dmg`, `Lumos-0.19.0-x64.dmg`
- Windows: `Lumos-Setup-0.19.0.exe`
- Linux: `Lumos-0.19.0-x86_64.AppImage`, `lumos_0.19.0_amd64.deb`
```

---

## Timeline

| Phase | Version | Duration | Key Actions |
|-------|---------|----------|-------------|
| **Preparation** | - | 1 week | Code review, testing plan |
| **Implementation** | v0.19.0 | 1 week | Core migration logic |
| **Testing** | v0.19.0-beta | 1 week | Beta testing with users |
| **Release** | v0.19.0 | - | Public release |
| **Deprecation** | v0.19-v0.22 | 2-3 months | Support old env vars |
| **Cleanup** | v0.23.0 | - | Remove backward compat |

---

## Risk Assessment

### High Risk
- ❌ **Data Loss**: Mitigated by copying (not moving) old data
- ❌ **Migration Failure**: Mitigated by fallback to old location

### Medium Risk
- ⚠️ **User Confusion**: Mitigated by clear release notes and notifications
- ⚠️ **Environment Variable Conflicts**: Mitigated by precedence rules

### Low Risk
- ✅ **Build Issues**: Mitigated by CI/CD testing
- ✅ **Documentation Gaps**: Mitigated by comprehensive docs update

---

## Success Criteria

1. ✅ Zero data loss during migration
2. ✅ All existing features work with new naming
3. ✅ Clear user communication about changes
4. ✅ Backward compatibility for 3+ releases
5. ✅ All tests pass on all platforms
6. ✅ Documentation fully updated

---

## Open Questions

1. **Should we delete old `~/.codepilot/` directory after successful migration?**
   - **Recommendation**: No, keep it for safety. Users can manually delete.

2. **Should we support importing from old location indefinitely?**
   - **Recommendation**: Yes, keep in migration path array for new users who might have old backups.

3. **Should we rename the GitHub repository?**
   - **Recommendation**: Yes, but set up redirects from old URL.

4. **Should we update the logo/icon?**
   - **Recommendation**: Optional, but consider for future release.

---

## Appendix: File Checklist

### Critical Files (Must Update)
- [ ] `src/lib/db/connection.ts`
- [ ] `src/lib/platform.ts`
- [ ] `electron/main.ts`
- [ ] `package.json`
- [ ] `electron-builder.yml`
- [ ] `README.md`
- [ ] `README_CN.md`
- [ ] `README_JA.md`

### Important Files (Should Update)
- [ ] `src/components/chat/CodePilotLogo.tsx` → `LumosLogo.tsx`
- [ ] `src/i18n/en.ts`
- [ ] `src/i18n/zh.ts`
- [ ] `CLAUDE.md`
- [ ] `dev.sh`
- [ ] `.gitignore`
- [ ] `src/app/api/uploads/route.ts`
- [ ] `src/app/api/media/serve/route.ts`

### Documentation Files
- [ ] All files in `docs/`
- [ ] All test files in `src/__tests__/`
- [ ] GitHub workflow files

### Low Priority (Nice to Have)
- [ ] Component imports across the codebase
- [ ] Comments and internal documentation
- [ ] Test fixtures and mock data

---

## Conclusion

This migration plan provides a comprehensive, low-risk path to rename CodePilot to Lumos while ensuring:
- Zero data loss for existing users
- Smooth automatic migration
- Clear communication
- Backward compatibility
- Easy rollback if needed

The phased approach allows us to gather feedback and make adjustments before removing backward compatibility.
