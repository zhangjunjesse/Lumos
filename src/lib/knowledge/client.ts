export interface KbCollection {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export type KnowledgeIngestJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface KnowledgeIngestJob {
  id: string;
  collection_id: string;
  source_dir: string;
  recursive: number;
  max_files: number;
  max_file_size: number;
  force_reprocess?: number;
  status: KnowledgeIngestJobStatus;
  total_files: number;
  processed_files: number;
  success_files: number;
  failed_files: number;
  skipped_files: number;
  duplicate_files: number;
  error: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type KnowledgeIngestJobItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'duplicate';

export interface KnowledgeIngestJobItem {
  id: string;
  job_id: string;
  idx: number;
  file_path: string;
  source_key: string;
  file_size: number;
  status: KnowledgeIngestJobItemStatus;
  attempts: number;
  item_id: string | null;
  mode: 'full' | 'reference';
  parse_error: string;
  error: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export async function getDefaultCollection(): Promise<KbCollection> {
  const res = await fetch('/api/knowledge/collections/default');
  if (!res.ok) {
    throw new Error('Failed to load default collection');
  }
  return res.json() as Promise<KbCollection>;
}

export async function importLocalFile(
  filePath: string,
  options?: { collectionId?: string; title?: string; sourceType?: 'local_file' | 'feishu'; tags?: string[]; sourceKey?: string; sourceId?: string },
) {
  const collectionId = options?.collectionId || (await getDefaultCollection()).id;
  const res = await fetch('/api/knowledge/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collection_id: collectionId,
      title: options?.title || filePath.split(/[/\\]/).pop() || 'Untitled',
      source_type: options?.sourceType || 'local_file',
      source_path: filePath,
      tags: options?.tags,
      source_key: options?.sourceKey,
      source_id: options?.sourceId,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || data?.message || 'Import failed');
  }
  return data;
}

export async function importFeishuDoc(options: {
  token: string;
  type: string;
  title: string;
  url: string;
  sessionId?: string;
  collectionId?: string;
}) {
  const res = await fetch('/api/feishu/docs/attach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: options.sessionId,
      token: options.token,
      type: options.type,
      title: options.title,
      url: options.url,
      mode: 'reference',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || data?.error || 'Attach failed');
  }
  if (!data.filePath) {
    throw new Error('Missing file path');
  }
  return importLocalFile(data.filePath, {
    collectionId: options.collectionId,
    title: options.title,
    sourceType: 'feishu',
    sourceKey: `feishu:${options.token}`,
    sourceId: options.token,
  });
}

export async function importFeishuFile(options: {
  token: string;
  title: string;
  name?: string;
  sessionId?: string;
  collectionId?: string;
}) {
  const res = await fetch('/api/feishu/drive/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: options.token,
      title: options.title,
      name: options.name,
      sessionId: options.sessionId,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || data?.error || 'Download failed');
  }
  if (!data.filePath) {
    throw new Error('Missing file path');
  }
  return importLocalFile(data.filePath, {
    collectionId: options.collectionId,
    title: options.title || data.fileName,
    sourceType: 'feishu',
    sourceKey: `feishu:file:${options.token}`,
    sourceId: options.token,
  });
}

export async function importUrl(url: string) {
  const res = await fetch('/api/clip/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || data?.message || 'Import failed');
  }
  return data;
}

export async function importDirectory(options: {
  directory: string;
  collectionId?: string;
  recursive?: boolean;
  baseDir?: string;
  mode?: 'reference' | 'ingest';
  title?: string;
  tags?: string[];
  forceReprocess?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
}) {
  const res = await fetch('/api/knowledge/import/directory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      directory: options.directory,
      collection_id: options.collectionId,
      recursive: options.recursive,
      baseDir: options.baseDir,
      mode: options.mode ?? 'reference',
      title: options.title,
      tags: options.tags,
      force_reprocess: options.forceReprocess === true,
      maxFiles: options.maxFiles,
      maxFileSize: options.maxFileSize,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || data?.message || 'Import failed');
  }
  return data;
}

export async function listDirectoryImportJobs(options?: {
  collectionId?: string;
  activeOnly?: boolean;
  limit?: number;
}): Promise<KnowledgeIngestJob[]> {
  const params = new URLSearchParams();
  if (options?.collectionId) params.set('collection_id', options.collectionId);
  if (options?.activeOnly) params.set('active', '1');
  if (typeof options?.limit === 'number') params.set('limit', String(options.limit));

  const qs = params.toString();
  const res = await fetch(`/api/knowledge/import/jobs${qs ? `?${qs}` : ''}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || data?.message || 'Failed to load import jobs');
  }
  return Array.isArray(data?.jobs) ? data.jobs : [];
}

export async function retryDirectoryImportJob(jobId: string): Promise<KnowledgeIngestJob> {
  const res = await fetch(`/api/knowledge/import/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || data?.message || 'Failed to retry import job');
  }
  return data?.job as KnowledgeIngestJob;
}

export async function getDirectoryImportJob(
  jobId: string,
  options?: { includeItems?: boolean; limit?: number },
): Promise<{ job: KnowledgeIngestJob; items?: KnowledgeIngestJobItem[] }> {
  const params = new URLSearchParams();
  if (options?.includeItems) params.set('include_items', '1');
  if (typeof options?.limit === 'number') params.set('limit', String(options.limit));
  const qs = params.toString();
  const res = await fetch(`/api/knowledge/import/jobs/${encodeURIComponent(jobId)}${qs ? `?${qs}` : ''}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || data?.message || 'Failed to load import job');
  }
  return {
    job: data?.job as KnowledgeIngestJob,
    items: Array.isArray(data?.items) ? (data.items as KnowledgeIngestJobItem[]) : undefined,
  };
}

export async function cancelDirectoryImportJob(jobId: string): Promise<KnowledgeIngestJob> {
  const res = await fetch(`/api/knowledge/import/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || data?.message || 'Failed to cancel import job');
  }
  return data?.job as KnowledgeIngestJob;
}

export async function clearDirectoryImportJobs(): Promise<{ cleared_jobs: number; cleared_items: number }> {
  const res = await fetch('/api/knowledge/import/jobs', {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || data?.message || 'Failed to clear import jobs');
  }
  return {
    cleared_jobs: Number(data?.cleared_jobs || 0),
    cleared_items: Number(data?.cleared_items || 0),
  };
}

export async function removeDirectoryKnowledge(options: {
  collectionId: string;
  sourceDir: string;
}): Promise<{ deleted_items: number; cleared_jobs: number; cleared_job_items: number }> {
  const res = await fetch('/api/knowledge/directories', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collection_id: options.collectionId,
      source_dir: options.sourceDir,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || data?.message || 'Failed to remove directory');
  }
  return {
    deleted_items: Number(data?.deleted_items || 0),
    cleared_jobs: Number(data?.cleared_jobs || 0),
    cleared_job_items: Number(data?.cleared_job_items || 0),
  };
}
