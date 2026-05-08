export const NATIVE_SPEC_REVIEW_SUMMARY_KEY = 'nativeSpecReview';

export type NativeSpecReviewStatus = 'pending' | 'accepted' | 'needs_changes';

export interface NativeSpecReview {
  status: NativeSpecReviewStatus;
  artifactVersion?: number;
  updatedAt?: string;
  acceptedAt?: string;
  note?: string;
}

export function getNativeSpecReview(
  summary: Record<string, unknown> | undefined,
): NativeSpecReview {
  return normalizeNativeSpecReview(summary?.[NATIVE_SPEC_REVIEW_SUMMARY_KEY]);
}

export function buildNativeSpecReviewPatch(input: {
  status: NativeSpecReviewStatus;
  artifactVersion?: number;
  note?: string;
  now?: string;
}): { nativeSpecReview: NativeSpecReview } {
  const now = input.now ?? new Date().toISOString();
  const review: NativeSpecReview = {
    status: input.status,
    updatedAt: now,
  };
  if (input.artifactVersion !== undefined) {
    review.artifactVersion = input.artifactVersion;
  }
  if (input.note?.trim()) {
    review.note = input.note.trim();
  }
  if (input.status === 'accepted') {
    review.acceptedAt = now;
  }
  return { [NATIVE_SPEC_REVIEW_SUMMARY_KEY]: review };
}

export function nativeSpecReviewLabel(status: NativeSpecReviewStatus): string {
  switch (status) {
    case 'accepted':
      return '已接受';
    case 'needs_changes':
      return '需修改';
    case 'pending':
    default:
      return '待确认';
  }
}

export function isNativeSpecReviewAcceptedForArtifact(
  review: NativeSpecReview,
  artifactVersion: number | undefined | null,
): boolean {
  return review.status === 'accepted'
    && typeof artifactVersion === 'number'
    && Number.isFinite(artifactVersion)
    && review.artifactVersion === artifactVersion;
}

function normalizeNativeSpecReview(value: unknown): NativeSpecReview {
  if (!value || typeof value !== 'object') {
    return { status: 'pending' };
  }
  const candidate = value as {
    status?: unknown;
    artifactVersion?: unknown;
    updatedAt?: unknown;
    acceptedAt?: unknown;
    note?: unknown;
  };
  const status = isNativeSpecReviewStatus(candidate.status)
    ? candidate.status
    : 'pending';
  const review: NativeSpecReview = { status };
  if (typeof candidate.artifactVersion === 'number' && Number.isFinite(candidate.artifactVersion)) {
    review.artifactVersion = candidate.artifactVersion;
  }
  if (typeof candidate.updatedAt === 'string' && candidate.updatedAt.trim()) {
    review.updatedAt = candidate.updatedAt;
  }
  if (typeof candidate.acceptedAt === 'string' && candidate.acceptedAt.trim()) {
    review.acceptedAt = candidate.acceptedAt;
  }
  if (typeof candidate.note === 'string' && candidate.note.trim()) {
    review.note = candidate.note.trim();
  }
  return review;
}

function isNativeSpecReviewStatus(value: unknown): value is NativeSpecReviewStatus {
  return value === 'pending' || value === 'accepted' || value === 'needs_changes';
}
