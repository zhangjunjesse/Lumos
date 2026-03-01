# CodePilot → Lumos Migration: Executive Summary

## Quick Decision Guide

### Recommended Naming Convention

| Component | Old Name | New Name | Rationale |
|-----------|----------|----------|-----------|
| **Data Directory** | `~/.codepilot/` | `~/.lumos/` | Matches package.json, electron-builder.yml |
| **Database File** | `codepilot.db` | `lumos.db` | Consistent with project branding |
| **Env Var Prefix** | `CODEPILOT_*` | `LUMOS_*` | Clean, consistent naming |
| **Claude Config** | `~/.codepilot/.claude/` | `~/.lumos/.claude/` | Isolated per-app config |
| **Uploads Dir** | `.codepilot-uploads/` | `~/.lumos/uploads/` | Centralized data storage |

### Migration Timeline

```
v0.19.0 (Now)          v0.20.0-v0.22.0        v0.23.0 (Future)
    │                         │                      │
    ├─ Auto-migration         ├─ Deprecation         ├─ Remove old support
    ├─ Support both           │  warnings            ├─ Clean up code
    └─ User notification      └─ Update docs         └─ Prompt cleanup
```

---

## Why This Approach?

### 1. User Experience First
- **Zero manual steps**: Migration happens automatically on first launch
- **No data loss**: Old directory preserved as backup
- **Transparent**: Users see a one-time notification, then everything works

### 2. Developer Friendly
- **Backward compatible**: Old env vars still work (with warnings)
- **Gradual transition**: 3-4 releases to adapt
- **Clear deprecation path**: Warnings guide users to new names

### 3. Future-Proof
- **Clean naming**: "Lumos" everywhere, no legacy baggage
- **Consistent branding**: Matches package.json, electron-builder.yml, app name
- **Easier maintenance**: Single source of truth for naming

---

## Critical Implementation Points

### 1. Migration Must Be Idempotent
```typescript
// ✅ GOOD: Check if already migrated
if (fs.existsSync(newDb)) return;

// ❌ BAD: Always copy, overwriting new data
fs.copyFileSync(oldDb, newDb);
```

### 2. Never Delete Old Data Automatically
```typescript
// ✅ GOOD: Preserve old directory
console.log('Old data preserved at:', oldDir);

// ❌ BAD: Delete old directory
fs.rmSync(oldDir, { recursive: true });
```

### 3. Handle WAL Mode Properly
```typescript
// ✅ GOOD: Copy all SQLite files
fs.copyFileSync(oldDb, newDb);
fs.copyFileSync(oldDb + '-wal', newDb + '-wal');
fs.copyFileSync(oldDb + '-shm', newDb + '-shm');

// ❌ BAD: Only copy main database
fs.copyFileSync(oldDb, newDb);
```

### 4. Support Both Env Vars During Transition
```typescript
// ✅ GOOD: New takes precedence, old still works
const dir = process.env.LUMOS_DATA_DIR
  || process.env.CLAUDE_GUI_DATA_DIR
  || defaultPath;

// ❌ BAD: Break existing users immediately
const dir = process.env.LUMOS_DATA_DIR || defaultPath;
```

---

## Risk Assessment

### Low Risk ✅
- Database migration (existing code already handles this)
- Environment variable fallback (simple conditional logic)
- Documentation updates (no code changes)

### Medium Risk ⚠️
- Electron packaging changes (test on all platforms)
- Upload directory migration (may have large files)
- i18n string updates (need translation review)

### High Risk 🔴
- Breaking old env vars too soon (wait 3-4 releases)
- Deleting old data automatically (never do this)
- Incomplete migration (must copy WAL/SHM files)

---

## Testing Strategy

### Unit Tests
```typescript
describe('Migration', () => {
  it('should migrate from .codepilot to .lumos', () => {
    // Setup old directory
    // Run migration
    // Verify new directory exists
    // Verify old directory preserved
  });

  it('should skip migration if already migrated', () => {
    // Setup new directory
    // Run migration
    // Verify no changes
  });

  it('should handle missing old directory', () => {
    // No old directory
    // Run migration
    // Verify fresh install
  });
});
```

### Integration Tests
1. **Fresh Install**: No old data → Should create `~/.lumos/`
2. **Existing User**: Has `~/.codepilot/` → Should migrate to `~/.lumos/`
3. **Already Migrated**: Has `~/.lumos/` → Should skip migration
4. **Env Var Override**: `LUMOS_DATA_DIR=/custom/path` → Should use custom path

### Manual Testing Checklist
- [ ] macOS: Fresh install
- [ ] macOS: Upgrade from v0.18.0
- [ ] Windows: Fresh install
- [ ] Windows: Upgrade from v0.18.0
- [ ] Linux: Fresh install
- [ ] Linux: Upgrade from v0.18.0
- [ ] Dev mode: `npm run electron:dev`
- [ ] Production: Packaged app
- [ ] Custom env vars: `LUMOS_DATA_DIR=/tmp/test`
- [ ] Legacy env vars: `CLAUDE_GUI_DATA_DIR=/tmp/test`

---

## Rollback Plan

### If Migration Fails

**Scenario 1: Migration crashes on startup**
```bash
# User can manually revert by setting env var
export CLAUDE_GUI_DATA_DIR=~/.codepilot
# App will use old location
```

**Scenario 2: Data corruption during migration**
```bash
# Old data is preserved, user can:
1. Delete ~/.lumos/
2. Restart app
3. Migration will retry from preserved ~/.codepilot/
```

**Scenario 3: Need to rollback to v0.18.0**
```bash
# Old directory still exists, downgrade works seamlessly
# v0.18.0 will use ~/.codepilot/ as before
```

---

## Communication Plan

### Release Notes (v0.19.0)

```markdown
## 🎉 Welcome to Lumos!

CodePilot has been renamed to **Lumos**. This release includes:

### Automatic Migration
- Your data has been automatically migrated from `~/.codepilot/` to `~/.lumos/`
- All settings, chat history, and files are preserved
- The old directory is kept as a backup

### What Changed
- Data directory: `~/.codepilot/` → `~/.lumos/`
- Database file: `codepilot.db` → `lumos.db`
- Environment variables: `CODEPILOT_*` → `LUMOS_*` (old names still work)

### Action Required
- **None!** Everything works automatically
- Optional: After verifying everything works, you can delete `~/.codepilot/`

### For Developers
- Update env vars in your scripts: `CODEPILOT_*` → `LUMOS_*`
- Old variable names are deprecated but still supported until v0.23.0
```

### In-App Notification

```typescript
// Show once after migration
if (fs.existsSync(path.join(dataDir, '.migrated-from-codepilot'))) {
  showNotification({
    title: 'Welcome to Lumos!',
    message: 'Your data has been migrated from CodePilot. Everything is ready to use.',
    type: 'info',
    actions: [
      { label: 'Learn More', url: 'https://github.com/op7418/Lumos/releases' },
      { label: 'Dismiss', action: 'dismiss' }
    ]
  });
}
```

---

## File Change Summary

### Core Changes (Must Do)
1. `src/lib/db/connection.ts` - Database path + migration logic
2. `src/lib/platform.ts` - Env var handling + deprecation warnings
3. `electron/main.ts` - Default API key env var
4. `package.json` - Dev script env vars
5. `dev.sh` - Dev script env vars

### Documentation (Must Do)
6. `README.md` - Update all references
7. `README_CN.md` - Update all references
8. `README_JA.md` - Update all references
9. `CLAUDE.md` - Update project instructions
10. `.gitignore` - Update ignored directories

### UI/UX (Should Do)
11. `src/i18n/en.ts` - Update strings
12. `src/i18n/zh.ts` - Update strings
13. `src/components/chat/CodePilotLogo.tsx` - Rename component
14. `src/components/settings/GeneralSection.tsx` - Update UI text

### Build/Deploy (Should Do)
15. `.github/workflows/build.yml` - Update workflow names
16. `scripts/after-pack.js` - Update comments
17. `electron-builder.yml` - Already done ✅

### Tests (Should Do)
18. All test files - Update test descriptions
19. Add migration tests

---

## Estimated Effort

| Phase | Tasks | Effort | Risk |
|-------|-------|--------|------|
| **Phase 1: Core Migration** | 5 files | 4-6 hours | Medium |
| **Phase 2: Documentation** | 5 files | 2-3 hours | Low |
| **Phase 3: UI/UX** | 4 files | 2-3 hours | Low |
| **Phase 4: Testing** | All platforms | 4-6 hours | Medium |
| **Phase 5: Release** | Build + deploy | 2-3 hours | Low |
| **Total** | ~20 files | **14-21 hours** | **Medium** |

---

## Success Criteria

### Must Have ✅
- [ ] Existing users can upgrade without data loss
- [ ] Fresh installs use new naming
- [ ] Old env vars still work (with warnings)
- [ ] Migration is idempotent (safe to run multiple times)
- [ ] Old data is preserved (not deleted)

### Should Have ⚠️
- [ ] In-app migration notification
- [ ] Deprecation warnings in console
- [ ] Updated documentation
- [ ] All tests passing
- [ ] Tested on all platforms

### Nice to Have 💡
- [ ] Migration analytics (how many users migrated)
- [ ] Cleanup wizard (help users delete old directory)
- [ ] Migration troubleshooting guide

---

## Next Steps

1. **Review this plan** with the team
2. **Create a feature branch**: `feat/rename-to-lumos`
3. **Implement Phase 1** (core migration)
4. **Test thoroughly** on all platforms
5. **Update documentation**
6. **Release v0.19.0** with migration
7. **Monitor for issues** in first week
8. **Plan Phase 2** (deprecation) for v0.20.0

---

## Questions & Answers

### Q: Why not just update in place?
**A:** Renaming the directory while the app is running is risky. Copying ensures data safety.

### Q: Why keep the old directory?
**A:** Safety net. If migration fails or user wants to rollback, old data is still there.

### Q: When can we delete old env var support?
**A:** After 3-4 releases (v0.23.0), giving users 2-3 months to adapt.

### Q: What if migration fails?
**A:** App falls back to old location via env var. User can manually fix and retry.

### Q: Do we need to migrate uploads directory?
**A:** Yes, but it's optional. If it fails, uploads still work (just in old location).

### Q: Should we rename the GitHub repo?
**A:** Yes, but separately. GitHub handles redirects automatically.

---

## Conclusion

This migration plan provides:
- ✅ **Safe** automatic migration with no data loss
- ✅ **Backward compatible** transition period
- ✅ **Clear** deprecation path
- ✅ **Testable** implementation with rollback plan
- ✅ **User-friendly** experience with minimal disruption

**Recommendation:** Proceed with Phase 1 implementation in v0.19.0.
