# CodePilot → Lumos Migration Phase 1 - Implementation Complete

## Summary

Successfully implemented Phase 1 of the CodePilot to Lumos migration, including:
- Data directory migration from `~/.codepilot/` to `~/.lumos/`
- Database file renamed from `codepilot.db` to `lumos.db`
- Environment variable updates with backward compatibility
- Automatic migration logic with safety checks

## Files Modified

### 1. Core Database Connection
**File:** `/Users/zhangjun/私藏/projects/探索/浏览器插件/浏览器ai助手/CodePilot/src/lib/db/connection.ts`

Changes:
- Updated `dataDir` to use `LUMOS_DATA_DIR` (with fallback to `CLAUDE_GUI_DATA_DIR`)
- Changed database filename from `codepilot.db` to `lumos.db`
- Added `migrateFromCodePilot()` function that:
  - Checks if `~/.lumos/` already exists (skip if migrated)
  - Copies database files (including WAL and SHM)
  - Recursively copies `.claude/` directory
  - Logs all operations
  - Cleans up on failure
- Migration runs automatically before database initialization

### 2. Platform Utilities
**File:** `/Users/zhangjun/私藏/projects/探索/浏览器插件/浏览器ai助手/CodePilot/src/lib/platform.ts`

Changes:
- Added `getEnvVar()` function for backward-compatible environment variable access
- Added `setEnvVar()` function for internal use
- Updated `getClaudeConfigDir()` to support both `LUMOS_CLAUDE_CONFIG_DIR` and `CODEPILOT_CLAUDE_CONFIG_DIR`
- Logs deprecation warnings when old variable names are used

### 3. Development Script
**File:** `/Users/zhangjun/私藏/projects/探索/浏览器插件/浏览器ai助手/CodePilot/dev.sh`

Changes:
- Updated comment from "CodePilot dev mode" to "Lumos dev mode"
- Changed `CODEPILOT_CLAUDE_CONFIG_DIR` to `LUMOS_CLAUDE_CONFIG_DIR`
- Changed `CLAUDE_GUI_DATA_DIR` to `LUMOS_DATA_DIR`
- Changed `CODEPILOT_DEFAULT_API_KEY` to `LUMOS_DEFAULT_KEY`

### 4. Package Scripts
**File:** `/Users/zhangjun/私藏/projects/探索/浏览器插件/浏览器ai助手/CodePilot/package.json`

Changes:
- Updated `electron:dev` script to use `LUMOS_CLAUDE_CONFIG_DIR` and `LUMOS_DATA_DIR`

### 5. Electron Main Process
**File:** `/Users/zhangjun/私藏/projects/探索/浏览器插件/浏览器ai助手/CodePilot/electron/main.ts`

Changes:
- Updated `initDefaultApiKey()` to support both `LUMOS_DEFAULT_KEY` and `CODEPILOT_DEFAULT_KEY`
- Added deprecation warning when old variable is used
- Updated server environment to use `LUMOS_DATA_DIR` and `LUMOS_CLAUDE_CONFIG_DIR`
- Changed `CODEPILOT_DEFAULT_API_KEY` to `LUMOS_DEFAULT_API_KEY` in env

### 6. Claude Client
**File:** `/Users/zhangjun/私藏/projects/探索/浏览器插件/浏览器ai助手/CodePilot/src/lib/claude-client.ts`

Changes:
- Updated Claude config directory detection to support both new and old variable names
- Added deprecation warning when `CODEPILOT_CLAUDE_CONFIG_DIR` is used

### 7. API Providers
**File:** `/Users/zhangjun/私藏/projects/探索/浏览器插件/浏览器ai助手/CodePilot/src/lib/db/providers.ts`

Changes:
- Updated `resetBuiltinProvider()` to support both `LUMOS_DEFAULT_API_KEY` and `CODEPILOT_DEFAULT_API_KEY`
- Added deprecation warning
- Updated error message to reference new variable name

### 8. Database Migrations
**File:** `/Users/zhangjun/私藏/projects/探索/浏览器插件/浏览器ai助手/CodePilot/src/lib/db/migrations-lumos.ts`

Changes:
- Updated builtin provider creation to support both new and old variable names
- Added deprecation warning when old variable is used

### 9. Document Upload API
**File:** `/Users/zhangjun/私藏/projects/探索/浏览器插件/浏览器ai助手/CodePilot/src/app/api/documents/upload/route.ts`

Changes:
- Updated `UPLOAD_DIR` to use `LUMOS_DATA_DIR` with fallback chain

### 10. Chat API
**File:** `/Users/zhangjun/私藏/projects/探索/浏览器插件/浏览器ai助手/CodePilot/src/app/api/chat/route.ts`

Changes:
- Updated Feishu MCP server data directory to use `LUMOS_DATA_DIR` with fallback

### 11. Feishu Auth
**File:** `/Users/zhangjun/私藏/projects/探索/浏览器插件/浏览器ai助手/CodePilot/src/lib/feishu-auth.ts`

Changes:
- Updated `dataDir` to use `LUMOS_DATA_DIR` with fallback chain

### 12. Image Generator
**File:** `/Users/zhangjun/私藏/projects/探索/浏览器插件/浏览器ai助手/CodePilot/src/lib/image-generator.ts`

Changes:
- Updated `dataDir` to use `LUMOS_DATA_DIR` with fallback chain

## Environment Variables

### New Variables (Preferred)
- `LUMOS_DATA_DIR` - Main data directory (default: `~/.lumos`)
- `LUMOS_CLAUDE_CONFIG_DIR` - Claude CLI config directory (default: `~/.lumos/.claude`)
- `LUMOS_DEFAULT_KEY` - Default API key for built-in provider
- `LUMOS_DEFAULT_API_KEY` - Alternative name for default API key

### Deprecated Variables (Still Supported)
- `CLAUDE_GUI_DATA_DIR` - Falls back to this if `LUMOS_DATA_DIR` not set
- `CODEPILOT_CLAUDE_CONFIG_DIR` - Falls back to this if `LUMOS_CLAUDE_CONFIG_DIR` not set
- `CODEPILOT_DEFAULT_KEY` - Falls back to this if `LUMOS_DEFAULT_KEY` not set
- `CODEPILOT_DEFAULT_API_KEY` - Falls back to this if `LUMOS_DEFAULT_API_KEY` not set

## Migration Behavior

### Automatic Migration
When the application starts:
1. Checks if `~/.lumos/` exists
2. If not, checks if `~/.codepilot/` exists
3. If old directory exists:
   - Creates `~/.lumos/` directory
   - Copies `codepilot.db` → `lumos.db`
   - Copies `codepilot.db-wal` and `codepilot.db-shm` if they exist
   - Recursively copies `.claude/` directory
   - Logs all operations to console
4. If migration fails, cleans up partial migration
5. Old data is preserved (copy, not move)

### Safety Features
- Migration only runs once (checks for existing `~/.lumos/`)
- All operations are logged
- Failures are caught and logged
- Partial migrations are cleaned up
- Original data is never deleted

### Backward Compatibility
- All old environment variables still work
- Deprecation warnings are logged (not shown to users)
- New variables take precedence over old ones
- Fallback chain ensures smooth transition

## Testing Checklist

Before deploying, test:
- [ ] Fresh install (no existing data)
- [ ] Migration from `~/.codepilot/` to `~/.lumos/`
- [ ] Existing `~/.lumos/` (skip migration)
- [ ] Old environment variables still work
- [ ] New environment variables take precedence
- [ ] Database opens correctly with new path
- [ ] Claude CLI config directory is isolated
- [ ] File uploads go to correct directory
- [ ] Feishu auth tokens stored in correct location
- [ ] Generated images saved to correct location

## Next Steps (Phase 2)

After Phase 1 is stable:
1. Update UI text references (CodePilot → Lumos)
2. Update documentation
3. Update component names (CodePilotLogo → LumosLogo)
4. Update i18n translations
5. Consider removing backward compatibility (breaking change)

## Rollback Plan

If issues arise:
1. Old data is preserved in `~/.codepilot/`
2. Set `LUMOS_DATA_DIR=~/.codepilot` to use old location
3. Database will still work (migration logic handles both names)
4. Revert code changes if needed

## Notes

- Migration is non-destructive (copy, not move)
- Users can manually delete `~/.codepilot/` after verifying migration
- Deprecation warnings are logged but not shown in UI
- All file paths use absolute paths for clarity
- Migration runs before database initialization to ensure data availability
