# Migration Implementation Checklist

## Phase 1: Core Migration (v0.19.0)

### 1. Database & Data Directory Migration

#### File: `src/lib/db/connection.ts`

**Current:**
```typescript
export const dataDir = process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
export const DB_PATH = path.join(dataDir, 'codepilot.db');
```

**New:**
```typescript
// Support both old and new env vars (new takes precedence)
function getDataDir(): string {
  if (process.env.LUMOS_DATA_DIR) {
    return process.env.LUMOS_DATA_DIR;
  }
  if (process.env.CLAUDE_GUI_DATA_DIR) {
    console.warn('[DEPRECATED] CLAUDE_GUI_DATA_DIR is deprecated. Use LUMOS_DATA_DIR instead.');
    return process.env.CLAUDE_GUI_DATA_DIR;
  }
  return path.join(os.homedir(), '.lumos');
}

export const dataDir = getDataDir();
export const DB_PATH = path.join(dataDir, 'lumos.db');
```

**Migration Logic (add before `getDb()`):**
```typescript
/**
 * Migrate data from old CodePilot directory to new Lumos directory.
 * This runs once on first launch after upgrade.
 */
function migrateFromCodePilot(): void {
  const newDir = dataDir;
  const newDb = DB_PATH;

  // Already migrated or fresh install
  if (fs.existsSync(newDb)) return;

  const oldDir = path.join(os.homedir(), '.codepilot');
  const oldDb = path.join(oldDir, 'codepilot.db');

  // No old installation to migrate
  if (!fs.existsSync(oldDb)) return;

  console.log('[migration] Migrating from CodePilot to Lumos...');
  console.log('[migration] Old location:', oldDir);
  console.log('[migration] New location:', newDir);

  try {
    // Create new directory
    fs.mkdirSync(newDir, { recursive: true });

    // Copy database files (main + WAL + SHM)
    fs.copyFileSync(oldDb, newDb);
    console.log('[migration] ✓ Copied database');

    if (fs.existsSync(oldDb + '-wal')) {
      fs.copyFileSync(oldDb + '-wal', newDb + '-wal');
      console.log('[migration] ✓ Copied WAL file');
    }

    if (fs.existsSync(oldDb + '-shm')) {
      fs.copyFileSync(oldDb + '-shm', newDb + '-shm');
      console.log('[migration] ✓ Copied SHM file');
    }

    // Migrate Claude config directory
    const oldClaudeConfig = path.join(oldDir, '.claude');
    const newClaudeConfig = path.join(newDir, '.claude');
    if (fs.existsSync(oldClaudeConfig)) {
      fs.cpSync(oldClaudeConfig, newClaudeConfig, { recursive: true });
      console.log('[migration] ✓ Copied Claude config');
    }

    // Create a migration marker file
    const markerPath = path.join(newDir, '.migrated-from-codepilot');
    fs.writeFileSync(markerPath, new Date().toISOString());

    console.log('[migration] ✅ Migration complete!');
    console.log('[migration] Old data preserved at:', oldDir);
    console.log('[migration] You can safely delete the old directory after verifying everything works.');
  } catch (err) {
    console.error('[migration] ❌ Migration failed:', err);
    throw new Error(`Failed to migrate from CodePilot: ${err}`);
  }
}
```

**Update `getDb()` function:**
```typescript
export function getDb(): Database.Database {
  if (!db) {
    // Run migration before opening database
    migrateFromCodePilot();

    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Update old paths to include .codepilot locations
    if (!fs.existsSync(DB_PATH)) {
      const home = os.homedir();
      const oldPaths = [
        path.join(home, '.codepilot', 'codepilot.db'),
        path.join(home, '.codepilot', 'lumos.db'),
        path.join(home, 'Library', 'Application Support', 'CodePilot', 'codepilot.db'),
        path.join(home, 'Library', 'Application Support', 'Lumos', 'lumos.db'),
        path.join(home, 'Library', 'Application Support', 'codepilot', 'codepilot.db'),
        path.join(home, 'Library', 'Application Support', 'Claude GUI', 'codepilot.db'),
        path.join(process.cwd(), 'data', 'codepilot.db'),
      ];
      // ... rest of existing migration logic
    }

    db = new Database(DB_PATH);
    // ... rest of existing code
  }
  return db;
}
```

**Checklist:**
- [ ] Update `getDataDir()` function with deprecation warning
- [ ] Change `DB_PATH` to use `lumos.db`
- [ ] Add `migrateFromCodePilot()` function
- [ ] Call migration in `getDb()` before opening database
- [ ] Update old paths array
- [ ] Test migration with existing `.codepilot` directory
- [ ] Test fresh install (no migration)
- [ ] Test already-migrated scenario

---

### 2. Platform & Environment Variables

#### File: `src/lib/platform.ts`

**Add new function:**
```typescript
/**
 * Get the Lumos data directory, respecting environment variables.
 * Supports both new (LUMOS_DATA_DIR) and legacy (CLAUDE_GUI_DATA_DIR) variables.
 */
export function getLumosDataDir(): string {
  if (process.env.LUMOS_DATA_DIR) {
    return process.env.LUMOS_DATA_DIR;
  }
  if (process.env.CLAUDE_GUI_DATA_DIR) {
    console.warn('[DEPRECATED] CLAUDE_GUI_DATA_DIR is deprecated. Use LUMOS_DATA_DIR instead.');
    return process.env.CLAUDE_GUI_DATA_DIR;
  }
  return path.join(os.homedir(), '.lumos');
}
```

**Update `getClaudeConfigDir()`:**
```typescript
export function getClaudeConfigDir(): string {
  // New variable takes precedence
  if (process.env.LUMOS_CLAUDE_CONFIG_DIR) {
    return process.env.LUMOS_CLAUDE_CONFIG_DIR;
  }

  // Legacy variable with deprecation warning
  if (process.env.CODEPILOT_CLAUDE_CONFIG_DIR) {
    console.warn('[DEPRECATED] CODEPILOT_CLAUDE_CONFIG_DIR is deprecated. Use LUMOS_CLAUDE_CONFIG_DIR instead.');
    return process.env.CODEPILOT_CLAUDE_CONFIG_DIR;
  }

  // Default: isolated config within Lumos data directory
  return path.join(getLumosDataDir(), '.claude');
}
```

**Checklist:**
- [ ] Add `getLumosDataDir()` function
- [ ] Update `getClaudeConfigDir()` with new env var
- [ ] Add deprecation warnings
- [ ] Test with new env vars
- [ ] Test with old env vars (should warn)
- [ ] Test with no env vars (should use defaults)

---

### 3. Electron Main Process

#### File: `electron/main.ts`

**Update `initDefaultApiKey()`:**
```typescript
function initDefaultApiKey(): string | undefined {
  const encPath = path.join(app.getPath('userData'), 'default-key.enc');

  if (fs.existsSync(encPath)) {
    try {
      const encrypted = fs.readFileSync(encPath);
      return safeStorage.decryptString(encrypted);
    } catch {
      fs.unlinkSync(encPath);
    }
  }

  // Check new env var first, then legacy
  const rawKey = process.env.LUMOS_DEFAULT_KEY || process.env.CODEPILOT_DEFAULT_KEY;

  if (process.env.CODEPILOT_DEFAULT_KEY && !process.env.LUMOS_DEFAULT_KEY) {
    console.warn('[DEPRECATED] CODEPILOT_DEFAULT_KEY is deprecated. Use LUMOS_DEFAULT_KEY instead.');
  }

  if (!rawKey) return undefined;

  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(encPath, safeStorage.encryptString(rawKey));
  }
  return rawKey;
}
```

**Add migration notification (in `createWindow()` after window is ready):**
```typescript
// Show migration notification if this is first launch after migration
const migrationMarker = path.join(dataDir, '.migrated-from-codepilot');
if (fs.existsSync(migrationMarker)) {
  // Read marker to check if we've already shown the notification
  const markerContent = fs.readFileSync(migrationMarker, 'utf-8');
  if (!markerContent.includes('notified')) {
    mainWindow.webContents.send('show-migration-notification', {
      title: 'Welcome to Lumos!',
      message: 'Your data has been successfully migrated from CodePilot. Everything should work as before.',
      oldPath: path.join(os.homedir(), '.codepilot'),
    });

    // Mark as notified
    fs.writeFileSync(migrationMarker, markerContent + '\nnotified');
  }
}
```

**Checklist:**
- [ ] Update `initDefaultApiKey()` to check both env vars
- [ ] Add deprecation warning for old env var
- [ ] Add migration notification logic
- [ ] Test API key encryption with new var
- [ ] Test migration notification display

---

### 4. Claude Client Configuration

#### File: `src/lib/claude-client.ts`

**Update environment variable references:**

Search for all instances of `CODEPILOT_` and add support for `LUMOS_` equivalents:

```typescript
// Example: If there are any direct env var checks, update them
const configDir = process.env.LUMOS_CLAUDE_CONFIG_DIR ||
                  process.env.CODEPILOT_CLAUDE_CONFIG_DIR ||
                  path.join(os.homedir(), '.lumos', '.claude');
```

**Checklist:**
- [ ] Search for `CODEPILOT_` references
- [ ] Add `LUMOS_` equivalents with precedence
- [ ] Add deprecation warnings where appropriate
- [ ] Test Claude CLI integration with new paths

---

### 5. Upload Directory Migration

#### File: `src/app/api/uploads/route.ts`

**Current:**
```typescript
const uploadsDir = path.join(process.cwd(), '.codepilot-uploads');
```

**New:**
```typescript
import { getLumosDataDir } from '@/lib/platform';

function getUploadsDir(): string {
  // New location: inside Lumos data directory
  const newDir = path.join(getLumosDataDir(), 'uploads');

  // Legacy location
  const oldDir = path.join(process.cwd(), '.codepilot-uploads');

  // Migrate if old exists and new doesn't
  if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) {
    console.log('[uploads] Migrating uploads directory...');
    fs.mkdirSync(path.dirname(newDir), { recursive: true });
    fs.cpSync(oldDir, newDir, { recursive: true });
    console.log('[uploads] Migration complete');
  }

  return newDir;
}

const uploadsDir = getUploadsDir();
```

**Checklist:**
- [ ] Update uploads directory path
- [ ] Add migration logic for uploads
- [ ] Test file upload after migration
- [ ] Test file serving after migration
- [ ] Update `.gitignore` to exclude `.lumos-uploads/` or `~/.lumos/uploads/`

---

### 6. Development Scripts

#### File: `package.json`

**Update dev script:**
```json
"electron:dev": "cross-env LUMOS_CLAUDE_CONFIG_DIR=$HOME/.lumos/.claude LUMOS_DATA_DIR=$HOME/.lumos concurrently -k \"next dev\" \"wait-on http://localhost:3000 && electron .\""
```

#### File: `dev.sh`

**Update environment variables:**
```bash
export LUMOS_CLAUDE_CONFIG_DIR="$HOME/.lumos/.claude"
export LUMOS_DATA_DIR="$HOME/.lumos"
```

**Checklist:**
- [ ] Update `package.json` scripts
- [ ] Update `dev.sh` script
- [ ] Test dev mode with new env vars
- [ ] Verify database location in dev mode

---

### 7. UI Components & Translations

#### File: `src/components/chat/CodePilotLogo.tsx`

**Rename to:** `src/components/chat/LumosLogo.tsx`

**Update component:**
```typescript
interface LumosLogoProps {
  className?: string;
}

export function LumosLogo({ className }: LumosLogoProps) {
  return (
    <svg
      viewBox="-150 -150 300 300"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("rounded-full", className)}
    >
      {/* Keep existing SVG content */}
      <defs>
        <g id="lumos-cube">
          {/* ... */}
        </g>
      </defs>
      {/* ... */}
    </svg>
  );
}
```

**Update all imports:**
```bash
# Find all files importing CodePilotLogo
grep -r "CodePilotLogo" src/
```

**Checklist:**
- [ ] Rename component file
- [ ] Update component name and props interface
- [ ] Update SVG id from `codepilot-cube` to `lumos-cube`
- [ ] Find and update all imports
- [ ] Test component rendering

#### File: `src/i18n/en.ts`

**Update translations:**
```typescript
'settings.description': 'Manage Lumos and Claude CLI settings',
'settings.lumos': 'Lumos',  // Changed from 'settings.codepilot'
```

#### File: `src/i18n/zh.ts`

**Update translations:**
```typescript
'settings.description': '管理 Lumos 和 Claude CLI 设置',
'settings.lumos': 'Lumos',
```

**Checklist:**
- [ ] Update English translations
- [ ] Update Chinese translations
- [ ] Update Japanese translations (if exists)
- [ ] Search for "CodePilot" in all i18n files
- [ ] Test UI with updated translations

---

### 8. Documentation Updates

#### Files to update:
- `README.md`
- `README_CN.md`
- `README_JA.md`
- `CLAUDE.md`
- `docs/*.md`

**Key changes:**
1. Replace "CodePilot" with "Lumos" in titles and descriptions
2. Update data directory paths: `~/.codepilot/` → `~/.lumos/`
3. Update database filename: `codepilot.db` → `lumos.db`
4. Update environment variables: `CODEPILOT_*` → `LUMOS_*`
5. Update repository URLs (if changing)
6. Add migration notice to README

**Example migration notice for README:**
```markdown
## Upgrading from CodePilot

If you're upgrading from a previous version named "CodePilot", your data will be automatically migrated to the new location on first launch:

- Old: `~/.codepilot/codepilot.db`
- New: `~/.lumos/lumos.db`

The old directory will be preserved for safety. You can delete it after verifying everything works correctly.
```

**Checklist:**
- [ ] Update README.md
- [ ] Update README_CN.md
- [ ] Update README_JA.md
- [ ] Update CLAUDE.md
- [ ] Add migration notice
- [ ] Update screenshots if they show "CodePilot" branding
- [ ] Update repository URLs if changed

---

### 9. Build Configuration

#### File: `electron-builder.yml`

**Already correct:**
```yaml
appId: com.lumos.app
productName: Lumos
```

**Verify:**
- [ ] appId is `com.lumos.app`
- [ ] productName is `Lumos`
- [ ] Desktop entry name is `Lumos`

#### File: `.gitignore`

**Update:**
```
# Old
.codepilot-uploads/

# New (or both during transition)
.codepilot-uploads/
.lumos-uploads/
```

**Checklist:**
- [ ] Verify electron-builder.yml
- [ ] Update .gitignore
- [ ] Test build process
- [ ] Verify app name in built packages

---

### 10. Test Files

#### Update test files that reference CodePilot:

Files to check:
- `src/__tests__/unit/message-persistence.test.ts`
- `src/__tests__/unit/files-security.test.ts`
- `src/__tests__/unit/db-shutdown.test.ts`
- `src/__tests__/unit/claude-session-parser.test.ts`

**Update test data paths and assertions:**
```typescript
// Old
const testDbPath = path.join(os.tmpdir(), 'codepilot-test.db');

// New
const testDbPath = path.join(os.tmpdir(), 'lumos-test.db');
```

**Checklist:**
- [ ] Update test database paths
- [ ] Update test assertions
- [ ] Run all tests
- [ ] Verify tests pass

---

## Phase 2: Testing & Validation

### Manual Testing Checklist

#### Fresh Install
- [ ] Install on clean system (no `.codepilot` or `.lumos`)
- [ ] Verify database created at `~/.lumos/lumos.db`
- [ ] Verify Claude config at `~/.lumos/.claude/`
- [ ] Create a chat session
- [ ] Upload a file
- [ ] Verify uploads at `~/.lumos/uploads/`
- [ ] Restart app, verify data persists

#### Migration from CodePilot
- [ ] Set up old installation with `.codepilot` directory
- [ ] Add some chat sessions and files
- [ ] Upgrade to new version
- [ ] Verify migration notification appears
- [ ] Verify database migrated to `~/.lumos/lumos.db`
- [ ] Verify all chat sessions preserved
- [ ] Verify all files accessible
- [ ] Verify Claude config migrated
- [ ] Verify old directory still exists (not deleted)

#### Environment Variables
- [ ] Test with `LUMOS_DATA_DIR` set
- [ ] Test with `LUMOS_CLAUDE_CONFIG_DIR` set
- [ ] Test with old `CLAUDE_GUI_DATA_DIR` (should warn)
- [ ] Test with old `CODEPILOT_CLAUDE_CONFIG_DIR` (should warn)
- [ ] Verify deprecation warnings appear in console
- [ ] Test with both old and new vars (new should take precedence)

#### Cross-Platform
- [ ] Test on macOS (Intel)
- [ ] Test on macOS (Apple Silicon)
- [ ] Test on Windows
- [ ] Test on Linux

#### Edge Cases
- [ ] Migration with corrupted database
- [ ] Migration with missing WAL/SHM files
- [ ] Migration with read-only old directory
- [ ] Multiple rapid restarts during migration
- [ ] Disk full during migration

---

## Phase 3: Release & Communication

### Release Notes Template

```markdown
# Lumos v0.19.0

## 🎉 Major Update: CodePilot is now Lumos!

We've renamed the project from **CodePilot** to **Lumos** to better reflect our vision and avoid naming conflicts.

### What's Changed

- **New name**: CodePilot → Lumos
- **New data location**: `~/.codepilot/` → `~/.lumos/`
- **New database**: `codepilot.db` → `lumos.db`
- **New environment variables**: `CODEPILOT_*` → `LUMOS_*`

### Automatic Migration

Your data will be **automatically migrated** on first launch:
- All chat sessions preserved
- All files and uploads preserved
- All settings preserved
- Old directory kept as backup

### Action Required

1. **Update environment variables** (if you use them):
   - `CLAUDE_GUI_DATA_DIR` → `LUMOS_DATA_DIR`
   - `CODEPILOT_CLAUDE_CONFIG_DIR` → `LUMOS_CLAUDE_CONFIG_DIR`
   - `CODEPILOT_DEFAULT_KEY` → `LUMOS_DEFAULT_KEY`

2. **Update scripts** that reference old paths

3. **Optional**: Delete `~/.codepilot/` after verifying everything works

### Backward Compatibility

Old environment variables will continue to work until v0.23.0 (with deprecation warnings).

### Bug Fixes & Improvements

- [List other changes in this release]

---

**Full Changelog**: https://github.com/[user]/Lumos/compare/v0.18.0...v0.19.0
```

### Communication Checklist

- [ ] Update GitHub repository name (if changing)
- [ ] Update repository description
- [ ] Create release with migration notes
- [ ] Pin migration announcement issue
- [ ] Update social media links
- [ ] Update documentation site (if exists)
- [ ] Notify users via email/newsletter (if applicable)

---

## Phase 4: Deprecation & Cleanup (v0.23.0)

### Remove Backward Compatibility

#### File: `src/lib/db/connection.ts`
```typescript
// Remove support for CLAUDE_GUI_DATA_DIR
export const dataDir = process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
```

#### File: `src/lib/platform.ts`
```typescript
// Remove support for CODEPILOT_CLAUDE_CONFIG_DIR
export function getClaudeConfigDir(): string {
  return process.env.LUMOS_CLAUDE_CONFIG_DIR || path.join(getLumosDataDir(), '.claude');
}
```

#### File: `electron/main.ts`
```typescript
// Remove support for CODEPILOT_DEFAULT_KEY
const rawKey = process.env.LUMOS_DEFAULT_KEY;
```

### Optional: Cleanup Prompt

Add a one-time prompt to delete old directory:

```typescript
// In electron/main.ts after app is ready
const oldDir = path.join(os.homedir(), '.codepilot');
const cleanupMarker = path.join(dataDir, '.cleanup-prompted');

if (fs.existsSync(oldDir) && !fs.existsSync(cleanupMarker)) {
  dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Clean Up Old Data',
    message: 'Lumos has detected an old CodePilot directory.',
    detail: `Would you like to delete the old directory?\n\nLocation: ${oldDir}\n\nYour data has already been migrated to the new location. This will free up disk space.`,
    buttons: ['Delete', 'Keep', 'Ask Later'],
    defaultId: 1,
    cancelId: 2,
  }).then(result => {
    if (result.response === 0) {
      // Delete
      fs.rmSync(oldDir, { recursive: true, force: true });
      console.log('[cleanup] Deleted old CodePilot directory');
    }
    if (result.response !== 2) {
      // Mark as prompted (unless "Ask Later")
      fs.writeFileSync(cleanupMarker, new Date().toISOString());
    }
  });
}
```

**Checklist:**
- [ ] Remove old env var support
- [ ] Remove deprecation warnings
- [ ] Add cleanup prompt (optional)
- [ ] Update documentation to remove migration notes
- [ ] Test that old env vars no longer work

---

## Rollback Plan

If critical issues are discovered after release:

### Immediate Actions
1. Pull the release from GitHub
2. Revert to previous version
3. Investigate root cause

### Data Recovery
Users can manually revert by:
1. Stopping the app
2. Deleting `~/.lumos/`
3. Reinstalling previous version
4. Old data still exists at `~/.codepilot/`

### Code Rollback
```bash
git revert [migration-commit-hash]
git push origin main
```

---

## Success Criteria

- [ ] Zero data loss during migration
- [ ] All existing features work with new paths
- [ ] Migration completes in <5 seconds
- [ ] Clear user communication
- [ ] Backward compatibility maintained for 3 releases
- [ ] All tests pass
- [ ] Documentation updated
- [ ] No breaking changes for users who don't use env vars

---

## Timeline

- **Week 1**: Implement core migration logic
- **Week 2**: Update all references and documentation
- **Week 3**: Testing and bug fixes
- **Week 4**: Release v0.19.0 with migration
- **Weeks 5-12**: Deprecation period (3 releases)
- **Week 13**: Remove backward compatibility in v0.23.0
