import type { AppDataStore, AppRow } from '@/lib/app/runtime/data-store';
import { getEcommerceStore } from './storage';
import type { SelectionEvidenceRecord } from './discover-evidence';

export const SELECTION_EVIDENCE_COLLECTION = 'selection_evidence';

export type SelectionEvidenceRow = AppRow<SelectionEvidenceRecord>;

export function getSelectionEvidenceStore(): AppDataStore {
  return getEcommerceStore();
}

export function listSelectionEvidence(
  store: AppDataStore,
  filter?: { research_id?: string; stage?: string; status?: string },
): SelectionEvidenceRow[] {
  return store.query<SelectionEvidenceRecord>(SELECTION_EVIDENCE_COLLECTION, {
    filter: filter as Record<string, unknown> | undefined,
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 500,
  });
}

export function persistSelectionEvidence(
  store: AppDataStore,
  records: Omit<SelectionEvidenceRecord, 'id' | 'created_at' | 'updated_at'>[],
): SelectionEvidenceRow[] {
  const now = new Date().toISOString();
  return records.map((record) => {
    const existing = store
      .query<SelectionEvidenceRecord>(SELECTION_EVIDENCE_COLLECTION, {
        filter: { research_id: record.research_id, stage: record.stage },
        limit: 1,
      })
      .at(0);
    if (existing) {
      return (
        store.update<SelectionEvidenceRecord>(SELECTION_EVIDENCE_COLLECTION, existing.id, {
          ...record,
          updated_at: now,
        } as Partial<SelectionEvidenceRecord>) ?? existing
      );
    }
    return store.create<SelectionEvidenceRecord>(SELECTION_EVIDENCE_COLLECTION, {
      ...record,
      created_at: now,
      updated_at: now,
    } as SelectionEvidenceRecord);
  });
}

export function deleteSelectionEvidenceByResearchId(
  store: AppDataStore,
  researchId: string,
): number {
  const rows = listSelectionEvidence(store, { research_id: researchId });
  let deleted = 0;
  for (const row of rows) {
    if (store.delete(SELECTION_EVIDENCE_COLLECTION, row.id)) deleted += 1;
  }
  return deleted;
}
