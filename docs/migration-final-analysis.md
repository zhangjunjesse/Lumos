# CodePilot to Lumos Migration: Final Analysis & Recommendations

## Project Overview

**Current State:**
- Package name: `lumos` ✅
- Product name: `Lumos` ✅
- App ID: `com.lumos.app` ✅
- Data directory: `~/.codepilot/` ❌
- Database: `codepilot.db` ❌
- Environment variables: `CODEPILOT_*` ❌
- Code references: Mixed (46 files) ❌

**Goal:** Complete the migration from CodePilot to Lumos branding across all aspects of the project.

---

## Recommended Approach

### 1. Naming Convention (Final Decision)

| Component | New Name | Justification |
|-----------|----------|---------------|
| **Data Directory** | `~/.lumos/` | Matches package.json, clean branding |
| **Database File** | `lumos.db` | Consistent with directory name |
| **Env Var Prefix** | `LUMOS_*` | Clear, consistent, future-proof |
| **Claude Config** | `~/.lumos/.claude/` | Isolated per-app configuration |
| **Uploads** | `~/.lumos/uploads/` | Centralized data management |

**Why this approach:**
- ✅ Consistent with existing `package.json` and `electron-builder.yml`
- ✅ Clean break from old naming (easier to search/replace)
- ✅ User-friendly (single `.lumos` directory)
- ✅ Future-proof (no legacy baggage)

### 2. Migration Strategy (3-Phase Approach)

#### Phase 1: Auto-Migration (v0.19.0) - IMMEDIATE
**Duration:** 1 release
**Goal:** Seamless migration for existing users

**Key Actions:**
1. Implement automatic data migration on first launch
2. Support both old and new environment variables
3. Preserve old directory as backup
4. Show one-time notification to users
5. Log migration details for debugging

**User Impact:** Zero manual steps required

#### Phase 2: Deprecation (v0.20.0 - v0.22.0) - 2-3 MONTHS
**Duration:** 3-4 releases
**Goal:** Give users time to update scripts and workflows

**Key Actions:**
1. Log deprecation warnings for old env vars
2. Update all documentation to use new names
3. Add migration notice to release notes
4. Monitor for issues via GitHub issues

**User Impact:** Warnings in console, but everything still works

#### Phase 3: Cleanup (v0.23.0+) - FUTURE
**Duration:** 1 release
**Goal:** Remove legacy code

**Key Actions:**
1. Remove support for old environment variables
2. Remove backward compatibility code
3. Optionally prompt users to delete old directory
4. Clean up codebase

**User Impact:** Old env vars stop working (well-communicated)

---

## Implementation Priority

### Critical Path (Must Do First)

1. **Database Migration** (`src/lib/db/connection.ts`)
   - Add `migrateFromCodePilot()` function
   - Update `DB_PATH` to use `lumos.db`
   - Test thoroughly (most critical component)

2. **Environment Variables** (`src/lib/platform.ts`)
   - Add `getLumosDataDir()` function
   - Update `getClaudeConfigDir()` with new env vars
   - Add deprecation warnings

3. **Electron Main** (`electron/main.ts`)
   - Update `initDefaultApiKey()` for `LUMOS_DEFAULT_KEY`
   - Add migration trigger on startup

4. **Dev Scripts** (`package.json`, `dev.sh`)
   - Update environment variables
   - Test dev mode works

### High Priority (Do Next)

5. **Upload Directories** (API routes)
   - Update all references to `.codepilot-uploads`
   - Migrate existing uploads to new location

6. **UI Components** (`CodePilotLogo.tsx`)
   - Rename to `LumosLogo.tsx`
   - Update all imports

7. **Internationalization** (`src/i18n/*.ts`)
   - Update all user-facing strings
   - Get translations reviewed

### Medium Priority (Can Wait)

8. **Documentation** (README, CLAUDE.md)
   - Update all references
   - Update screenshots if needed

9. **Test Files** (`src/__tests__/**`)
   - Update test descriptions
   - Update mock data

10. **GitHub Actions** (`.github/workflows/*.yml`)
    - Update workflow names
    - Update artifact names

### Low Priority (Nice to Have)

11. **Comments & Internal Docs**
    - Update code comments
    - Update internal documentation

12. **Git History**
    - Consider adding `.mailmap` for author attribution
    - Update repository description

---

## Risk Analysis

### High Risk Areas 🔴

1. **Database Migration**
   - **Risk:** Data loss or corruption
   - **Mitigation:**
     - Copy, never move
     - Include WAL/SHM files
     - Preserve old directory
     - Test on all platforms

2. **Electron Packaging**
   - **Risk:** App won't start after upgrade
   - **Mitigation:**
     - Test packaged apps on all platforms
     - Provide rollback instructions
     - Monitor first 48 hours after release

### Medium Risk Areas ⚠️

3. **Environment Variables**
   - **Risk:** Breaking existing user scripts
   - **Mitigation:**
     - Support both old and new (3-4 releases)
     - Clear deprecation warnings
     - Update documentation early

4. **Upload Directory Migration**
   - **Risk:** Large files, slow migration
   - **Mitigation:**
     - Migrate on-demand (lazy migration)
     - Show progress indicator
     - Handle errors gracefully

### Low Risk Areas ✅

5. **UI Text Changes**
   - **Risk:** Translation inconsistencies
   - **Mitigation:**
     - Review all translations
     - Use consistent terminology

6. **Documentation Updates**
   - **Risk:** Outdated docs confuse users
   - **Mitigation:**
     - Update docs in same PR as code
     - Add migration guide

---

## Testing Strategy

### Automated Tests

```typescript
// Unit tests for migration logic
describe('migrateFromCodePilot', () => {
  it('should migrate database and config files');
  it('should skip if already migrated');
  it('should handle missing old directory');
  it('should preserve old directory');
  it('should copy WAL and SHM files');
});

// Integration tests
describe('Data Directory', () => {
  it('should use LUMOS_DATA_DIR if set');
  it('should fall back to CLAUDE_GUI_DATA_DIR with warning');
  it('should use default ~/.lumos if no env vars');
});

// E2E tests
describe('Migration E2E', () => {
  it('should migrate on first launch after upgrade');
  it('should show migration notification');
  it('should work with migrated data');
});
```

### Manual Testing Checklist

**Pre-Migration (v0.18.0):**
- [ ] Create test data in `~/.codepilot/`
- [ ] Add some chat sessions
- [ ] Upload some files
- [ ] Configure Claude CLI settings

**Post-Migration (v0.19.0):**
- [ ] Verify data migrated to `~/.lumos/`
- [ ] Verify all chat sessions present
- [ ] Verify uploaded files accessible
- [ ] Verify Claude CLI settings work
- [ ] Verify old directory preserved
- [ ] Verify migration notification shown

**Platform Testing:**
- [ ] macOS (Intel)
- [ ] macOS (Apple Silicon)
- [ ] Windows 10/11
- [ ] Linux (Ubuntu/Debian)
- [ ] Linux (Fedora/RHEL)

**Scenario Testing:**
- [ ] Fresh install (no old data)
- [ ] Upgrade from v0.18.0
- [ ] Already migrated (v0.19.0 → v0.19.1)
- [ ] Custom env vars set
- [ ] Dev mode (`npm run electron:dev`)
- [ ] Production (packaged app)

---

## Backward Compatibility

### What We Support (Phase 1 & 2)

✅ **Old Environment Variables** (with warnings)
```bash
CLAUDE_GUI_DATA_DIR=~/.codepilot  # Still works
CODEPILOT_CLAUDE_CONFIG_DIR=~/.codepilot/.claude  # Still works
CODEPILOT_DEFAULT_KEY=sk-...  # Still works
```

✅ **Old Data Directory**
- If `~/.codepilot/` exists and `~/.lumos/` doesn't, auto-migrate
- Old directory preserved after migration

✅ **Old Database Filename**
- Migration logic checks for `codepilot.db` in old locations

### What We Don't Support

❌ **Downgrading After Migration**
- Once migrated to v0.19.0, downgrading to v0.18.0 requires manual steps
- Mitigation: Keep old directory, document rollback process

❌ **Mixed Environments**
- Can't use `~/.codepilot/` and `~/.lumos/` simultaneously
- Mitigation: Migration is one-way, clear communication

---

## Communication Plan

### Release Notes Template (v0.19.0)

```markdown
# Lumos v0.19.0 - The Great Rename

## 🎉 CodePilot is now Lumos!

We've completed the rebranding from CodePilot to Lumos. This release includes automatic migration of your data.

### What's New

- **Automatic Migration**: Your data is automatically migrated from `~/.codepilot/` to `~/.lumos/`
- **Zero Downtime**: Everything works seamlessly, no manual steps required
- **Backup Preserved**: Your old `~/.codepilot/` directory is kept as a backup

### What Changed

| Old | New |
|-----|-----|
| `~/.codepilot/` | `~/.lumos/` |
| `codepilot.db` | `lumos.db` |
| `CODEPILOT_*` env vars | `LUMOS_*` env vars |

### Action Required

**For most users:** Nothing! The migration happens automatically.

**For developers/power users:**
- Update your scripts to use `LUMOS_*` environment variables
- Old variable names still work but will show deprecation warnings
- Support for old names will be removed in v0.23.0

### Verification

After upgrading, verify everything works:
1. Open Lumos
2. Check that your chat history is present
3. Verify uploaded files are accessible
4. (Optional) Delete `~/.codepilot/` after confirming everything works

### Rollback

If you encounter issues:
1. Your old data is preserved at `~/.codepilot/`
2. Set `CLAUDE_GUI_DATA_DIR=~/.codepilot` to use the old location
3. Report issues on GitHub

### Full Changelog

- feat: Automatic migration from CodePilot to Lumos
- feat: Support for new `LUMOS_*` environment variables
- refactor: Rename database from `codepilot.db` to `lumos.db`
- refactor: Rename data directory from `~/.codepilot/` to `~/.lumos/`
- docs: Update all documentation for Lumos branding
- chore: Update UI components and translations
```

### In-App Notification

```typescript
// Show once after successful migration
{
  title: "Welcome to Lumos!",
  message: "Your data has been migrated from CodePilot. Everything is ready to use.",
  actions: [
    { label: "Learn More", url: "https://github.com/..." },
    { label: "Got It", dismiss: true }
  ]
}
```

### Documentation Updates

1. **README.md**: Update all references, screenshots
2. **CLAUDE.md**: Update project name, paths
3. **Migration Guide**: Create new doc explaining the change
4. **FAQ**: Add section on migration

---

## Rollback Plan

### If Migration Fails

**Scenario 1: App won't start**
```bash
# Set env var to use old location
export CLAUDE_GUI_DATA_DIR=~/.codepilot
# Restart app
```

**Scenario 2: Data appears corrupted**
```bash
# Delete new directory
rm -rf ~/.lumos
# Restart app (will retry migration)
```

**Scenario 3: Need to downgrade**
```bash
# Old directory is preserved
# Downgrade to v0.18.0
# App will use ~/.codepilot automatically
```

### Emergency Hotfix Plan

If critical issues discovered within 48 hours:
1. Prepare v0.19.1 with fixes
2. Fast-track testing (4-6 hours)
3. Emergency release
4. Notify users via GitHub

---

## Success Metrics

### Technical Metrics

- [ ] Migration success rate > 99%
- [ ] Zero data loss incidents
- [ ] App startup time < 5s (including migration)
- [ ] Migration time < 10s for typical database

### User Metrics

- [ ] < 5% of users report migration issues
- [ ] < 1% of users need manual intervention
- [ ] User satisfaction maintained (GitHub stars, feedback)

### Code Quality Metrics

- [ ] Test coverage > 80% for migration code
- [ ] All automated tests passing
- [ ] No regressions in existing functionality

---

## Timeline Estimate

### Phase 1: Implementation (1-2 weeks)

**Week 1:**
- [ ] Day 1-2: Implement database migration logic
- [ ] Day 3-4: Update environment variables and platform code
- [ ] Day 5: Update UI components and translations

**Week 2:**
- [ ] Day 1-2: Update documentation and scripts
- [ ] Day 3-4: Write tests and fix bugs
- [ ] Day 5: Code review and final testing

### Phase 2: Testing (3-5 days)

- [ ] Day 1: Automated tests
- [ ] Day 2-3: Manual testing on all platforms
- [ ] Day 4: Beta testing with volunteers
- [ ] Day 5: Final verification

### Phase 3: Release (1 day)

- [ ] Morning: Final build and packaging
- [ ] Afternoon: Release v0.19.0
- [ ] Evening: Monitor for issues

### Phase 4: Monitoring (1 week)

- [ ] Day 1-2: Active monitoring, quick fixes
- [ ] Day 3-7: Respond to user feedback
- [ ] Week 2+: Prepare deprecation warnings for Phase 2

---

## Conclusion

### Recommended Next Steps

1. **Review this analysis** with the team
2. **Create GitHub issue** to track migration work
3. **Set up project board** with tasks from checklist
4. **Assign owners** for each component
5. **Start with critical path** (database migration)
6. **Test early and often** on all platforms
7. **Communicate clearly** with users throughout

### Key Takeaways

✅ **Migration is low-risk** with proper planning
✅ **Backward compatibility** ensures smooth transition
✅ **Automatic migration** provides great UX
✅ **Phased approach** allows for course correction
✅ **Clear communication** prevents user confusion

### Final Recommendation

**Proceed with the migration using the 3-phase approach outlined above.**

The benefits (clean branding, consistent naming, better UX) outweigh the risks (which are well-mitigated). The existing codebase already has migration logic, so we're building on proven foundations.

**Estimated total effort:** 2-3 weeks from start to stable release.

---

## Appendix: Quick Reference

### Environment Variables

| Old | New | Status |
|-----|-----|--------|
| `CLAUDE_GUI_DATA_DIR` | `LUMOS_DATA_DIR` | Deprecated in v0.19.0, removed in v0.23.0 |
| `CODEPILOT_CLAUDE_CONFIG_DIR` | `LUMOS_CLAUDE_CONFIG_DIR` | Deprecated in v0.19.0, removed in v0.23.0 |
| `CODEPILOT_DEFAULT_KEY` | `LUMOS_DEFAULT_KEY` | Deprecated in v0.19.0, removed in v0.23.0 |

### File Paths

| Old | New |
|-----|-----|
| `~/.codepilot/` | `~/.lumos/` |
| `~/.codepilot/codepilot.db` | `~/.lumos/lumos.db` |
| `~/.codepilot/.claude/` | `~/.lumos/.claude/` |
| `.codepilot-uploads/` | `~/.lumos/uploads/` |

### Component Names

| Old | New |
|-----|-----|
| `CodePilotLogo` | `LumosLogo` |
| `codepilot-cube` (SVG ID) | `lumos-cube` |

### Files to Modify

**Critical (11 files):**
- `src/lib/db/connection.ts`
- `src/lib/platform.ts`
- `electron/main.ts`
- `src/lib/claude-client.ts`
- `package.json`
- `dev.sh`
- `.gitignore`
- `src/components/chat/CodePilotLogo.tsx` → `LumosLogo.tsx`
- `src/i18n/en.ts`
- `src/i18n/zh.ts`
- `src/app/api/uploads/route.ts`

**High Priority (10+ files):**
- All files importing `CodePilotLogo`
- API routes handling uploads
- Settings components
- Test files

**Medium Priority (20+ files):**
- Documentation (README, CLAUDE.md, etc.)
- GitHub workflows
- Build scripts

**Total estimated:** ~50 files to modify

---

**Document Version:** 1.0
**Last Updated:** 2026-03-01
**Author:** Migration Analysis Team
**Status:** Ready for Review
