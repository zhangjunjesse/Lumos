export interface KnowledgeReadinessRow {
  processing_status?: string | null;
  chunk_count?: number | null;
  processing_detail?: string | null;
  summary?: string | null;
  key_points?: string | null;
  tags?: string | null;
}

function parseProcessingDetail(detailRaw?: string | null): Record<string, string> {
  if (!detailRaw) return {};
  try {
    const parsed = JSON.parse(detailRaw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
    );
  } catch {
    return {};
  }
}

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function isKnowledgeItemIndexReady(
  item: KnowledgeReadinessRow | null | undefined,
): boolean {
  return item?.processing_status === 'ready' && Number(item.chunk_count ?? 0) > 0;
}

export function needsKnowledgeItemEnhancement(
  item: KnowledgeReadinessRow | null | undefined,
): boolean {
  if (!isKnowledgeItemIndexReady(item)) return false;
  const detail = parseProcessingDetail(item?.processing_detail);
  const summaryStage = detail.summary;
  const hasSummary = Boolean(item?.summary?.trim());
  const hasKeyPoints = parseStringArray(item?.key_points).length > 0;
  if (hasSummary && hasKeyPoints) return false;

  return (
    summaryStage === 'skipped' ||
    summaryStage === 'failed' ||
    summaryStage === 'done' ||
    summaryStage === 'pending' ||
    !summaryStage
  );
}

export function isKnowledgeItemEnhancementReady(
  item: KnowledgeReadinessRow | null | undefined,
): boolean {
  return isKnowledgeItemIndexReady(item) && !needsKnowledgeItemEnhancement(item);
}

export function isKnowledgeItemReadyForLibrary(
  item: KnowledgeReadinessRow | null | undefined,
): boolean {
  return isKnowledgeItemIndexReady(item) && isKnowledgeItemEnhancementReady(item);
}
