import create from 'zustand';
import type { KnowledgeRetrievalMode } from '@/types';

export interface KnowledgeTag {
  id: string;
  name: string;
  category: string;
  color: string;
  usage_count?: number;
}

export interface KnowledgeDefaults {
  retrievalMode: KnowledgeRetrievalMode;
  rewriteEnabled: boolean;
  topK: number;
  candidatePool: number;
}

interface AsyncResource<T> {
  value: T | null;
  loading: boolean;
  error: string | null;
  loaded: boolean;
}

interface KnowledgeCacheState {
  tags: AsyncResource<KnowledgeTag[]>;
  defaults: AsyncResource<KnowledgeDefaults>;

  loadTags: (force?: boolean) => Promise<void>;
  loadDefaults: (force?: boolean) => Promise<void>;

  invalidateTags: () => void;
  invalidateDefaults: () => void;

  setOverrideTags: (tags: KnowledgeTag[]) => void;
}

const EMPTY_RESOURCE = <T,>(): AsyncResource<T> => ({
  value: null,
  loading: false,
  error: null,
  loaded: false,
});

function parseTags(raw: unknown): KnowledgeTag[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): KnowledgeTag | null => {
      if (!entry || typeof entry !== 'object') return null;
      const r = entry as Record<string, unknown>;
      const id = typeof r.id === 'string' ? r.id.trim() : '';
      const name = typeof r.name === 'string' ? r.name.trim() : '';
      if (!id || !name) return null;
      return {
        id,
        name,
        category: typeof r.category === 'string' ? r.category : 'custom',
        color: typeof r.color === 'string' && r.color.trim() ? r.color : '#6B7280',
        usage_count: typeof r.usage_count === 'number' ? r.usage_count : 0,
      };
    })
    .filter((tag): tag is KnowledgeTag => tag !== null);
}

function parseDefaults(settings: Record<string, string>): KnowledgeDefaults {
  const mode: KnowledgeRetrievalMode = (settings.kb_retrieval_mode || '').trim().toLowerCase() === 'enhanced'
    ? 'enhanced'
    : 'reference';
  const rewriteEnabled = settings.kb_query_rewrite_enabled !== 'false';
  const topKRaw = Number(settings.kb_context_top_k || '4');
  const topK = Number.isFinite(topKRaw) && topKRaw > 0
    ? Math.max(1, Math.min(10, Math.floor(topKRaw)))
    : 4;
  const poolRaw = Number(settings.kb_candidate_pool_size || '40');
  const candidatePool = Number.isFinite(poolRaw) && poolRaw > 0
    ? Math.max(16, Math.min(120, Math.floor(poolRaw)))
    : 40;
  return { retrievalMode: mode, rewriteEnabled, topK, candidatePool };
}

export const useKnowledgeCacheStore = create<KnowledgeCacheState>((set, get) => ({
  tags: EMPTY_RESOURCE<KnowledgeTag[]>(),
  defaults: EMPTY_RESOURCE<KnowledgeDefaults>(),

  loadTags: async (force = false) => {
    const current = get().tags;
    if (current.loading) return;
    if (current.loaded && !force) return;

    set((state) => ({ tags: { ...state.tags, loading: true, error: null } }));
    try {
      const res = await fetch('/api/knowledge/tags');
      if (!res.ok) throw new Error('Failed to load knowledge tags');
      const data = await res.json();
      set({ tags: { value: parseTags(data), loading: false, error: null, loaded: true } });
    } catch (err) {
      set((state) => ({
        tags: {
          ...state.tags,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load knowledge tags',
          loaded: true,
        },
      }));
    }
  },

  loadDefaults: async (force = false) => {
    const current = get().defaults;
    if (current.loading) return;
    if (current.loaded && !force) return;

    set((state) => ({ defaults: { ...state.defaults, loading: true, error: null } }));
    try {
      const res = await fetch('/api/settings/app');
      if (!res.ok) throw new Error('Failed to load knowledge defaults');
      const data = await res.json();
      const settings: Record<string, string> = (data?.settings || {}) as Record<string, string>;
      set({
        defaults: {
          value: parseDefaults(settings),
          loading: false,
          error: null,
          loaded: true,
        },
      });
    } catch (err) {
      set((state) => ({
        defaults: {
          ...state.defaults,
          value: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load knowledge defaults',
          loaded: true,
        },
      }));
    }
  },

  invalidateTags: () => {
    set({ tags: EMPTY_RESOURCE<KnowledgeTag[]>() });
  },

  invalidateDefaults: () => {
    set({ defaults: EMPTY_RESOURCE<KnowledgeDefaults>() });
  },

  setOverrideTags: (tags) => {
    set({ tags: { value: tags, loading: false, error: null, loaded: true } });
  },
}));
