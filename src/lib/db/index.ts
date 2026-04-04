export { getDb, closeDb, dataDir, DB_PATH } from './connection';
export { initDb } from './schema';
export { migrateCoreTables } from './migrations';
export { migrateLumosTables } from './migrations-lumos';
export {
  listDeepSearchSites,
  getDeepSearchSite,
  getDeepSearchSiteCookieValue,
  getDeepSearchSiteState,
  upsertDeepSearchSite,
  upsertDeepSearchSiteState,
  listDeepSearchRuns,
  getDeepSearchRun,
  getDeepSearchArtifact,
  createDeepSearchRun,
  appendDeepSearchRunPageBindings,
  replaceDeepSearchRunPageBindings,
  replaceDeepSearchRunResults,
  updateDeepSearchRunExecution,
  applyDeepSearchRunAction,
  deleteDeepSearchRun,
  appendDeepSearchRunResult,
  updateDeepSearchRunArchivedAt,
} from './deepsearch';

// Session + Message + Settings + Status
export {
  getAllSessions,
  getSession,
  createSession,
  deleteSession,
  updateSessionTimestamp,
  updateSessionTitle,
  updateSdkSessionId,
  updateSessionModel,
  updateSessionResolvedModel,
  updateSessionProvider,
  updateSessionProviderId,
  updateSessionSystemPrompt,
  getDefaultProviderId,
  setDefaultProviderId,
  updateSessionWorkingDirectory,
  updateSessionMode,
  getMessages,
  addMessage,
  updateMessageContent,
  updateMessageBySessionAndHint,
  clearSessionMessages,
  getSetting,
  setSetting,
  getAllSettings,
  updateSessionStatus,
} from './sessions';

// Tasks
export {
  getTasksBySession,
  getTask,
  createTask,
  updateTask,
  deleteTask,
} from './tasks';

// Providers
export {
  getAllProviders,
  getProvider,
  getActiveProvider,
  getDefaultProvider,
  createProvider,
  cloneProvider,
  updateProvider,
  deleteProvider,
  ProviderValidationError,
  ProviderActivationBlockedError,
  ProviderDeletionBlockedError,
  ProviderUpdateBlockedError,
  activateProvider,
  deactivateAllProviders,
  getBuiltinProvider,
  resetBuiltinProvider,
} from './providers';

// Token stats
export { getTokenUsageStats } from './token-stats';

// Media
export {
  createMediaJob,
  getMediaJob,
  getMediaJobsBySession,
  getAllMediaJobs,
  updateMediaJobStatus,
  updateMediaJobCounters,
  deleteMediaJob,
  createMediaJobItems,
  getMediaJobItems,
  getMediaJobItem,
  getPendingJobItems,
  updateMediaJobItem,
  cancelPendingJobItems,
  createContextEvent,
  markContextEventSynced,
} from './media';

// Runtime locks
export {
  acquireSessionLock,
  renewSessionLock,
  releaseSessionLock,
  setSessionRuntimeStatus,
} from './runtime';

// Permissions
export {
  createPermissionRequest,
  resolvePermissionRequest,
  expirePermissionRequests,
  getPermissionRequest,
} from './permissions';

// Skills
export {
  getAllSkills,
  getSkillsByScope,
  getEnabledSkills,
  getSkill,
  getSkillByNameAndScope,
  createSkill,
  updateSkill,
  deleteSkill,
  toggleSkillEnabled,
} from './skills';

// MCP Servers
export {
  getAllMcpServers,
  getMcpServersByScope,
  getEnabledMcpServers,
  getMcpServer,
  getMcpServerByNameAndScope,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  toggleMcpServerEnabled,
  getEnabledMcpServersAsConfig,
} from './mcp-servers';

// Memories
export {
  getMemory,
  listMemoriesForContext,
  listRecentMemories,
  upsertMemory,
  touchMemoriesUsage,
  archiveMemory,
  setMemoryPinned,
  setMemoryArchived,
  updateMemory,
  updateMemoryContent,
  deleteMemory,
} from './memories';

// Memory intelligence events
export {
  createMemoryIntelligenceEvent,
  listRecentMemoryIntelligenceEvents,
  getLatestMemoryIntelligenceEventForSession,
  countMemoryIntelligenceEventsByDay,
  listMemoryIntelligenceEventsSince,
} from './memory-intelligence-events';
