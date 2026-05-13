import { parseVideoTags } from './parsers';

export interface CurationInputs {
  transcript_status?: string;
  tags?: string | null;
  notes?: string | null;
}

export interface CurationCompleteness {
  score: number;
  total: number;
  missing: string[];
}

/**
 * Score a video's curation state on a 3-point scale: transcript /
 * tags / notes. Drives the "完整度 X/3" badge in OrganizeTab
 * so users see at-a-glance which curation step is still pending.
 *
 * Honest contract:
 *   - transcript: only `transcript_status='success'` counts; pending
 *     and failed are equally incomplete from the curation lens.
 *   - tags: at least one tag after parseVideoTags() (so JSON-array
 *     `["a"]`, comma string, and CJK separators all count uniformly).
 *   - notes: any non-empty string after trim — user's own learning
 *     notes (Round 83), separate from the knowledge-base index summary.
 *
 * `missing` is the ordered list of which of the three pillars is empty;
 * UI uses it to show "缺：标签 / 备注" inline.
 */
export function computeCurationCompleteness(input: CurationInputs): CurationCompleteness {
  const missing: string[] = [];
  let score = 0;

  if (input.transcript_status === 'success') score += 1;
  else missing.push('字幕');

  if (input.tags && parseVideoTags(input.tags).length > 0) score += 1;
  else missing.push('标签');

  if (input.notes && input.notes.trim().length > 0) score += 1;
  else missing.push('备注');

  return { score, total: 3, missing };
}
