export interface NativeAppAcceptanceItem {
  id: string;
  label: string;
  howToVerify: string;
}

export interface NativeAppSpecForUi {
  summary?: string;
  acceptance: NativeAppAcceptanceItem[];
}

export function parseNativeAppSpecForUi(value: unknown): NativeAppSpecForUi | null {
  if (!value || typeof value !== 'object') return null;
  const spec = value as { summary?: unknown; acceptance?: unknown };
  return {
    summary: typeof spec.summary === 'string' ? spec.summary : undefined,
    acceptance: Array.isArray(spec.acceptance)
      ? spec.acceptance
        .map(normalizeAcceptanceItem)
        .filter((item): item is NativeAppAcceptanceItem => item !== null)
      : [],
  };
}

function normalizeAcceptanceItem(item: unknown): NativeAppAcceptanceItem | null {
  if (!item || typeof item !== 'object') return null;
  const candidate = item as {
    id?: unknown;
    label?: unknown;
    howToVerify?: unknown;
  };
  if (
    typeof candidate.id !== 'string'
    || typeof candidate.label !== 'string'
    || typeof candidate.howToVerify !== 'string'
  ) {
    return null;
  }
  return {
    id: candidate.id,
    label: candidate.label,
    howToVerify: candidate.howToVerify,
  };
}
