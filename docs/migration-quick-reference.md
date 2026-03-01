# Migration Quick Reference Card

## TL;DR - What You Need to Know

### Old → New Mapping

```
~/.codepilot/                    → ~/.lumos/
~/.codepilot/codepilot.db        → ~/.lumos/lumos.db
~/.codepilot/.claude/            → ~/.lumos/.claude/
.codepilot-uploads/              → ~/.lumos/uploads/

CLAUDE_GUI_DATA_DIR              → LUMOS_DATA_DIR
CODEPILOT_CLAUDE_CONFIG_DIR      → LUMOS_CLAUDE_CONFIG_DIR
CODEPILOT_DEFAULT_KEY            → LUMOS_DEFAULT_KEY

CodePilotLogo                    → LumosLogo
```

---

## Critical Rules

### ✅ DO

1. **Always check if migration already happened**
   ```typescript
   if (fs.existsSync(newDb)) return; // Already migrated
   ```

2. **Copy, never move**
   ```typescript
   fs.copyFileSync(oldDb, newDb); // ✅ Preserves original
   ```

3. **Include WAL/SHM files**
   ```typescript
   fs.copyFileSync(oldDb + '-wal', newDb + '-wal');
   fs.copyFileSync(oldDb + '-shm', newDb + '-shm');
   ```

4. **Support both env vars during transition**
   ```typescript
   const dir = process.env.LUMOS_DATA_DIR
     || process.env.CLAUDE_GUI_DATA_DIR
     || defaultPath;
   ```

5. **Log deprecation warnings**
   ```typescript
   console.warn('[DEPRECATED] CLAUDE_GUI_DATA_DIR is deprecated. Use LUMOS_DATA_DIR instead.');
   ```

### ❌ DON'T

1. **Never delete old data automatically**
   ```typescript
   fs.rmSync(oldDir, { recursive: true }); // ❌ NEVER DO THIS
   ```

2. **Don't break old env vars immediately**
   ```typescript
   const dir = process.env.LUMOS_DATA_DIR || defaultPath; // ❌ Breaks existing users
   ```

3. **Don't skip WAL/SHM files**
   ```typescript
   fs.copyFileSync(oldDb, newDb); // ❌ Incomplete migration
   // Missing: -wal and -shm files
   ```

4. **Don't migrate on every startup**
   ```typescript
   // ❌ BAD: Always copies
   fs.copyFileSync(oldDb, newDb);

   // ✅ GOOD: Check first
   if (!fs.existsSync(newDb) && fs.existsSync(oldDb)) {
     fs.copyFileSync(oldDb, newDb);
   }
   ```

---

## Code Snippets

### Migration Function Template

```typescript
function migrateFromCodePilot(): void {
  const newDir = path.join(os.homedir(), '.lumos');
  const newDb = path.join(newDir, 'lumos.db');

  // Skip if already migrated
  if (fs.existsSync(newDb)) return;

  const oldDir = path.join(os.homedir(), '.codepilot');
  const oldDb = path.join(oldDir, 'codepilot.db');

  // Skip if no old installation
  if (!fs.existsSync(oldDb)) return;

  console.log('[migration] Migrating from CodePilot to Lumos...');

  try {
    // Create new directory
    fs.mkdirSync(newDir, { recursive: true });

    // Copy database files
    fs.copyFileSync(oldDb, newDb);
    if (fs.existsSync(oldDb + '-wal')) {
      fs.copyFileSync(oldDb + '-wal', newDb + '-wal');
    }
    if (fs.existsSync(oldDb + '-shm')) {
      fs.copyFileSync(oldDb + '-shm', newDb + '-shm');
    }

    // Copy Claude config
    const oldConfig = path.join(oldDir, '.claude');
    const newConfig = path.join(newDir, '.claude');
    if (fs.existsSync(oldConfig)) {
      fs.cpSync(oldConfig, newConfig, { recursive: true });
    }

    console.log('[migration] ✅ Migration complete!');
    console.log('[migration] Old data preserved at:', oldDir);
  } catch (err) {
    console.error('[migration] ❌ Migration failed:', err);
    throw err;
  }
}
```

### Environment Variable Helper

```typescript
function getDataDir(): string {
  // New variable takes precedence
  if (process.env.LUMOS_DATA_DIR) {
    return process.env.LUMOS_DATA_DIR;
  }

  // Legacy variable with warning
  if (process.env.CLAUDE_GUI_DATA_DIR) {
    console.warn(
      '[DEPRECATED] CLAUDE_GUI_DATA_DIR is deprecated. ' +
      'Use LUMOS_DATA_DIR instead. ' +
      'Support will be removed in v0.23.0.'
    );
    return process.env.CLAUDE_GUI_DATA_DIR;
  }

  // Default
  return path.join(os.homedir(), '.lumos');
}
```

### Component Rename Pattern

```typescript
// Before
import { CodePilotLogo } from '@/components/chat/CodePilotLogo';

export function MyComponent() {
  return <CodePilotLogo className="w-8 h-8" />;
}

// After
import { LumosLogo } from '@/components/chat/LumosLogo';

export function MyComponent() {
  return <LumosLogo className="w-8 h-8" />;
}
```

---

## Testing Checklist

### Before Committing

- [ ] Run unit tests: `npm test`
- [ ] Test dev mode: `npm run electron:dev`
- [ ] Test with old env vars (should warn)
- [ ] Test with new env vars (should work)
- [ ] Test with no env vars (should use defaults)

### Before Releasing

- [ ] Test fresh install (no old data)
- [ ] Test upgrade (with old data)
- [ ] Test already-migrated scenario
- [ ] Test on macOS
- [ ] Test on Windows
- [ ] Test on Linux
- [ ] Test packaged app (not just dev mode)
- [ ] Verify old directory is preserved
- [ ] Verify WAL/SHM files are copied
- [ ] Verify uploads are accessible

---

## Common Pitfalls

### 1. Forgetting WAL/SHM Files

**Problem:** Database appears empty after migration

**Cause:** SQLite WAL mode uses separate files for transactions

**Solution:**
```typescript
// Copy all three files
fs.copyFileSync(oldDb, newDb);
fs.copyFileSync(oldDb + '-wal', newDb + '-wal');
fs.copyFileSync(oldDb + '-shm', newDb + '-shm');
```

### 2. Migration Runs on Every Startup

**Problem:** Performance degradation, potential data loss

**Cause:** Not checking if migration already happened

**Solution:**
```typescript
// Always check first
if (fs.existsSync(newDb)) return;
```

### 3. Breaking Existing Users

**Problem:** App crashes with "Cannot find database"

**Cause:** Removed old env var support too soon

**Solution:**
```typescript
// Support both for 3-4 releases
const dir = process.env.LUMOS_DATA_DIR
  || process.env.CLAUDE_GUI_DATA_DIR
  || defaultPath;
```

### 4. Upload Directory Not Migrated

**Problem:** Attached images/files missing after upgrade

**Cause:** Forgot to migrate `.codepilot-uploads/`

**Solution:**
```typescript
const oldUploads = path.join(process.cwd(), '.codepilot-uploads');
const newUploads = path.join(newDir, 'uploads');
if (fs.existsSync(oldUploads)) {
  fs.cpSync(oldUploads, newUploads, { recursive: true });
}
```

---

## File Change Summary

### Must Change (Critical)
- `src/lib/db/connection.ts` - Database path and migration
- `src/lib/platform.ts` - Environment variables
- `electron/main.ts` - Default API key
- `package.json` - Dev script env vars
- `dev.sh` - Dev environment setup

### Should Change (High Priority)
- `src/components/chat/CodePilotLogo.tsx` - Rename to LumosLogo
- All files importing CodePilotLogo - Update imports
- `src/i18n/en.ts` - Update English strings
- `src/i18n/zh.ts` - Update Chinese strings
- `src/app/api/uploads/route.ts` - Upload directory path

### Nice to Change (Medium Priority)
- `README.md` - Update documentation
- `README_CN.md` - Update Chinese docs
- `README_JA.md` - Update Japanese docs
- `CLAUDE.md` - Update project instructions
- `.gitignore` - Update upload directory name

### Optional (Low Priority)
- Test files - Update descriptions
- Comments - Update references
- GitHub Actions - Update workflow names

---

## Timeline

```
Week 1: Core Implementation
├─ Day 1-2: Database migration logic
├─ Day 3: Environment variables
├─ Day 4: Electron main process
└─ Day 5: Testing

Week 2: UI & Documentation
├─ Day 1-2: Component renames
├─ Day 3: i18n updates
├─ Day 4: Documentation
└─ Day 5: Final testing

Week 3: Release
├─ Day 1: Package and test on all platforms
├─ Day 2: Create release notes
├─ Day 3: Tag and release v0.19.0
├─ Day 4-5: Monitor for issues
└─ Week 4+: Support and bug fixes
```

---

## Emergency Rollback

If something goes wrong:

```bash
# Option 1: Use old directory
export CLAUDE_GUI_DATA_DIR=~/.codepilot
export CODEPILOT_CLAUDE_CONFIG_DIR=~/.codepilot/.claude

# Option 2: Downgrade to v0.18.0
# Old directory is preserved, so downgrade works seamlessly

# Option 3: Manual recovery
mv ~/.lumos/lumos.db ~/.lumos/lumos.db.backup
cp ~/.codepilot/codepilot.db ~/.lumos/lumos.db
```

---

## Support Resources

- **Migration Plan:** `docs/codepilot-to-lumos-migration.md`
- **Implementation Checklist:** `docs/migration-implementation-checklist.md`
- **File Changes:** `docs/migration-file-changes.md`
- **Final Analysis:** `docs/migration-final-analysis.md`
- **This Card:** `docs/migration-quick-reference.md`

---

## Questions?

**Q: Can users keep using old env vars?**
A: Yes, until v0.23.0 (3-4 releases away)

**Q: Will old data be deleted?**
A: No, old directory is preserved as backup

**Q: What if migration fails?**
A: App will throw error, old data is safe, user can retry

**Q: Do users need to do anything?**
A: No, migration is automatic on first launch

**Q: What about custom data directories?**
A: Env vars still work, just use new names (LUMOS_*)

---

**Last Updated:** 2026-03-01
**Version:** v0.19.0 (Migration Release)
