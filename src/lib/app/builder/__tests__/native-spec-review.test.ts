import {
  buildNativeSpecReviewPatch,
  getNativeSpecReview,
  isNativeSpecReviewAcceptedForArtifact,
  nativeSpecReviewLabel,
} from '../native-spec-review';

describe('native spec review helpers', () => {
  it('defaults missing or malformed review state to pending', () => {
    expect(getNativeSpecReview(undefined)).toEqual({ status: 'pending' });
    expect(getNativeSpecReview({ nativeSpecReview: { status: 'done' } })).toEqual({
      status: 'pending',
    });
  });

  it('builds an accepted review patch with artifact version and timestamp', () => {
    expect(buildNativeSpecReviewPatch({
      status: 'accepted',
      artifactVersion: 3,
      now: '2026-05-07T12:00:00.000Z',
    })).toEqual({
      nativeSpecReview: {
        status: 'accepted',
        artifactVersion: 3,
        updatedAt: '2026-05-07T12:00:00.000Z',
        acceptedAt: '2026-05-07T12:00:00.000Z',
      },
    });
  });

  it('normalizes labels for UI badges', () => {
    expect(nativeSpecReviewLabel('pending')).toBe('待确认');
    expect(nativeSpecReviewLabel('accepted')).toBe('已接受');
    expect(nativeSpecReviewLabel('needs_changes')).toBe('需修改');
  });

  it('only accepts the exact artifact version the user reviewed', () => {
    const review = getNativeSpecReview({
      nativeSpecReview: {
        status: 'accepted',
        artifactVersion: 3,
      },
    });

    expect(isNativeSpecReviewAcceptedForArtifact(review, 3)).toBe(true);
    expect(isNativeSpecReviewAcceptedForArtifact(review, 4)).toBe(false);
    expect(isNativeSpecReviewAcceptedForArtifact({ status: 'pending' }, 3)).toBe(false);
    expect(isNativeSpecReviewAcceptedForArtifact(review, undefined)).toBe(false);
  });
});
