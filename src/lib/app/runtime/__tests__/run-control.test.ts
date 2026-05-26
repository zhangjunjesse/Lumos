import {
  markRunCancelled,
  isRunCancelled,
  clearRunCancellation,
  _resetRunControlForTests,
} from '../run-control';

beforeEach(() => _resetRunControlForTests());

describe('run-control', () => {
  it('returns false for unknown run', () => {
    expect(isRunCancelled('douyin-collector', 'job-1')).toBe(false);
  });

  it('marks a run cancelled and reads it back', () => {
    markRunCancelled('douyin-collector', 'job-1');
    expect(isRunCancelled('douyin-collector', 'job-1')).toBe(true);
  });

  it('isolates by appId — same runId in different apps is not cross-cancelled', () => {
    markRunCancelled('douyin-collector', 'shared-id');
    expect(isRunCancelled('etsy-erank', 'shared-id')).toBe(false);
  });

  it('clearRunCancellation removes the entry so a fresh run with the same id is not pre-cancelled', () => {
    markRunCancelled('douyin-collector', 'job-1');
    clearRunCancellation('douyin-collector', 'job-1');
    expect(isRunCancelled('douyin-collector', 'job-1')).toBe(false);
  });

  it('silently ignores empty appId or runId', () => {
    markRunCancelled('', 'job-1');
    markRunCancelled('app', '');
    expect(isRunCancelled('', 'job-1')).toBe(false);
    expect(isRunCancelled('app', '')).toBe(false);
  });
});
