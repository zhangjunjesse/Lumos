import type {
  ApiProvider,
  ProviderModelCatalogSource,
  ProviderModelOption,
} from '@/types';

export const BUILTIN_CLAUDE_MODEL_IDS = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
  haiku: 'claude-haiku-4-5',
} as const;

type BuiltinClaudeModelAlias = keyof typeof BUILTIN_CLAUDE_MODEL_IDS;

export const DEFAULT_PROVIDER_MODEL_OPTIONS: ProviderModelOption[] = [
  { value: BUILTIN_CLAUDE_MODEL_IDS.sonnet, label: 'Claude Sonnet 4.6' },
  { value: BUILTIN_CLAUDE_MODEL_IDS.opus, label: 'Claude Opus 4.6' },
  { value: BUILTIN_CLAUDE_MODEL_IDS.haiku, label: 'Claude Haiku 4.5' },
];

const REQUESTED_MODEL_LABELS: Record<string, string> = {
  sonnet: 'Claude Sonnet',
  opus: 'Claude Opus',
  haiku: 'Claude Haiku',
};

const REQUESTED_MODEL_TARGET_PREFIXES: Record<string, string> = {
  sonnet: 'claude-sonnet-',
  opus: 'claude-opus-',
  haiku: 'claude-haiku-',
};

function dedupeProviderModelOptions(models: ProviderModelOption[]): ProviderModelOption[] {
  const seen = new Set<string>();
  const result: ProviderModelOption[] = [];

  for (const model of models) {
    const key = `${model.value}::${model.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(model);
  }

  return result;
}

function normalizeProviderModelOption(entry: unknown): ProviderModelOption | null {
  if (typeof entry === 'string') {
    const value = entry.trim();
    if (!value) return null;
    return { value, label: value };
  }

  if (!entry || typeof entry !== 'object') return null;

  const candidate = entry as { value?: unknown; label?: unknown; id?: unknown; name?: unknown };
  const rawValue = typeof candidate.value === 'string'
    ? candidate.value
    : typeof candidate.id === 'string'
      ? candidate.id
      : '';
  const value = rawValue.trim();
  if (!value) return null;

  const rawLabel = typeof candidate.label === 'string'
    ? candidate.label
    : typeof candidate.name === 'string'
      ? candidate.name
      : '';
  const label = rawLabel.trim() || value;

  return { value, label };
}

function normalizeProviderModelCatalogSource(source?: string | null): ProviderModelCatalogSource {
  if (source === 'manual' || source === 'detected' || source === 'default') {
    return source;
  }
  return 'default';
}

export function parseProviderModelCatalog(modelCatalog?: string | null): ProviderModelOption[] {
  const normalized = modelCatalog?.trim() || '';
  if (!normalized) return [];

  try {
    const parsed = JSON.parse(normalized);
    if (!Array.isArray(parsed)) return [];
    return dedupeProviderModelOptions(
      parsed
        .map((entry) => normalizeProviderModelOption(entry))
        .filter((entry): entry is ProviderModelOption => Boolean(entry)),
    );
  } catch {
    return [];
  }
}

export function serializeProviderModelCatalog(models: ProviderModelOption[]): string {
  return JSON.stringify(dedupeProviderModelOptions(models));
}

export function parseProviderModelCatalogEditor(text?: string | null): ProviderModelOption[] {
  const normalized = text?.trim() || '';
  if (!normalized) return [];

  if (normalized.startsWith('[')) {
    return parseProviderModelCatalog(normalized);
  }

  return dedupeProviderModelOptions(
    normalized
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [valuePart, ...labelParts] = line.split('|');
        const value = valuePart?.trim() || '';
        const label = labelParts.join('|').trim() || value;
        if (!value) return null;
        return { value, label };
      })
      .filter((entry): entry is ProviderModelOption => Boolean(entry)),
  );
}

export function formatProviderModelCatalogForEditor(modelCatalog?: string | null): string {
  return parseProviderModelCatalog(modelCatalog)
    .map((model) => (model.label && model.label !== model.value
      ? `${model.value} | ${model.label}`
      : model.value))
    .join('\n');
}

export function resolveBuiltInClaudeModelId(
  requested?: string | null,
  fallback: BuiltinClaudeModelAlias = 'sonnet',
): string {
  const normalized = requested?.trim().toLowerCase() || '';
  if (!normalized) return BUILTIN_CLAUDE_MODEL_IDS[fallback];
  if (normalized.startsWith('claude-')) return requested!.trim();

  const alias = inferRequestedModelAlias(normalized);
  if (alias === 'sonnet' || alias === 'opus' || alias === 'haiku') {
    return BUILTIN_CLAUDE_MODEL_IDS[alias];
  }

  return requested!.trim();
}

export function getProviderModelCatalogMeta(
  provider?: Pick<ApiProvider, 'provider_type' | 'model_catalog' | 'model_catalog_source' | 'model_catalog_updated_at'> | null,
): {
  models: ProviderModelOption[];
  source: ProviderModelCatalogSource;
  updatedAt: string | null;
  usesDefault: boolean;
} {
  if (provider?.provider_type === 'gemini-image') {
    return {
      models: [],
      source: normalizeProviderModelCatalogSource(provider.model_catalog_source),
      updatedAt: provider.model_catalog_updated_at || null,
      usesDefault: false,
    };
  }

  const configured = parseProviderModelCatalog(provider?.model_catalog);
  if (configured.length > 0) {
    return {
      models: configured,
      source: normalizeProviderModelCatalogSource(provider?.model_catalog_source || 'manual'),
      updatedAt: provider?.model_catalog_updated_at || null,
      usesDefault: false,
    };
  }

  return {
    models: DEFAULT_PROVIDER_MODEL_OPTIONS,
    source: 'default',
    updatedAt: provider?.model_catalog_updated_at || null,
    usesDefault: true,
  };
}

export function getProviderModelOptions(
  provider?: Pick<ApiProvider, 'provider_type' | 'model_catalog' | 'model_catalog_source' | 'model_catalog_updated_at'> | null,
): ProviderModelOption[] {
  return getProviderModelCatalogMeta(provider).models;
}

export function inferRequestedModelAlias(value?: string | null): string {
  const normalized = value?.trim().toLowerCase() || '';
  if (!normalized) return '';
  if (normalized === 'sonnet' || normalized.includes('sonnet')) return 'sonnet';
  if (normalized === 'opus' || normalized.includes('opus')) return 'opus';
  if (normalized === 'haiku' || normalized.includes('haiku')) return 'haiku';
  return normalized;
}

export function findProviderModelOption(
  value?: string | null,
  options?: ProviderModelOption[] | null,
): ProviderModelOption | null {
  const normalized = value?.trim() || '';
  if (!normalized || !options?.length) return null;

  const exactMatch = options.find((option) => option.value === normalized);
  if (exactMatch) return exactMatch;

  const alias = inferRequestedModelAlias(normalized);
  if (!alias) return null;

  return options.find((option) => inferRequestedModelAlias(option.value) === alias) || null;
}

export function getRequestedModelLabel(
  value?: string | null,
  options?: ProviderModelOption[] | null,
): string {
  const normalized = value?.trim() || '';
  if (!normalized) return '';

  const providerOption = findProviderModelOption(normalized, options);
  if (providerOption) {
    return providerOption.label;
  }

  const alias = inferRequestedModelAlias(normalized);
  return REQUESTED_MODEL_LABELS[alias] || normalized;
}

export function doesResolvedModelMatchRequested(
  requestedModel?: string | null,
  resolvedModel?: string | null,
): boolean {
  const requested = requestedModel?.trim() || '';
  const resolved = resolvedModel?.trim().toLowerCase() || '';

  if (!requested || !resolved) return true;

  if (requested.toLowerCase().startsWith('claude-')) {
    return requested.toLowerCase() === resolved;
  }

  const alias = inferRequestedModelAlias(requested);
  const targetPrefix = REQUESTED_MODEL_TARGET_PREFIXES[alias];
  if (!targetPrefix) return true;

  return resolved.startsWith(targetPrefix);
}
