export const DOUYIN_COLLECTOR_APP_ID = 'douyin-collector';

export const COLLECTION_CREATORS = 'creators';
export const COLLECTION_KEYWORDS = 'keywords';
export const COLLECTION_JOBS = 'collect_jobs';
export const COLLECTION_VIDEOS = 'videos';
export const COLLECTION_TRANSCRIPTS = 'transcripts';
export const COLLECTION_LIBRARY_LINKS = 'library_links';

export const CREATOR_CADENCES = ['hourly', 'daily', 'weekly', 'manual'] as const;
export const KEYWORD_TIME_WINDOWS = ['day', 'week', 'month', 'all'] as const;
export const JOB_KINDS = ['creator', 'keyword', 'link'] as const;
export const JOB_STATUSES = [
  'queued',
  'running',
  'success',
  'failed',
  'cancelled',
] as const;
