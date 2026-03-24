/** Knowledge base shared types */

export type KbProcessingStatus =
  | 'pending'
  | 'parsing'
  | 'chunking'
  | 'indexing'
  | 'embedding'
  | 'summarizing'
  | 'ready'
  | 'partial'
  | 'reference_only'
  | 'failed';

export type KbStageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface KbCollection {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface KbItem {
  id: string;
  collection_id: string;
  title: string;
  source_type: 'local_file' | 'feishu' | 'manual' | 'webpage' | 'local_dir';
  source_path: string;
  source_key: string;
  content: string;
  tags: string;  // JSON array string
  doc_date: string;  // document date for time-aware retrieval
  summary: string;  // AI-generated summary
  summary_embedding: Buffer | null;  // summary vector for summary-level search
  health_status: 'healthy' | 'stale' | 'outdated' | 'archived';
  reference_count: number;
  chunk_count: number;
  processing_status: KbProcessingStatus;
  processing_detail: string; // JSON object: { parse, chunk, bm25, embedding, summary, mode }
  processing_error: string;
  processing_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface KbChunk {
  id: string;
  item_id: string;
  content: string;
  chunk_index: number;
  embedding: Buffer | null;
  metadata: string;  // JSON string
}

export interface SearchResult {
  item_id: string;
  kb_uri: string;
  chunk_content: string;
  item_title: string;
  source_path: string;
  source_type: string;
  score: number;
  collection_name: string;
  retrieval_mode: 'reference' | 'enhanced';
  match_terms?: string[];
}

// ---- Parsed document output ----

export interface ParsedDocument {
  title: string;
  content: string;
  metadata: DocumentMetadata;
}

export interface DocumentMetadata {
  pageCount?: number;
  sheetNames?: string[];
  wordCount: number;
  charCount: number;
  fileSize?: number;
  mimeType?: string;
}

// ---- Tag system ----

export type TagCategory = 'domain' | 'tech' | 'doctype' | 'project' | 'custom';

export interface CategorizedTag {
  name: string;
  category: TagCategory;
  confidence: number;  // 0-1
}

export interface TagResult {
  matched: string[];
  suggested: string[];
}

export interface CategorizedTagResult {
  matched: CategorizedTag[];
  suggested: CategorizedTag[];
}

// ---- Summary ----

export interface DocumentSummary {
  itemId: string;
  summary: string;
  keyPoints: string[];
  generatedAt: string;
}

// ---- Relations ----

export interface DocumentRelation {
  sourceItemId: string;
  targetItemId: string;
  relationType: 'topic_similar' | 'time_related';
  score: number;  // cosine similarity or rule score
  createdAt: string;
}

// ---- Health ----

export interface HealthScore {
  itemId: string;
  activity: number;  // reference_count * e^(-days/90)
  isStale: boolean;
  isOutdated: boolean;
  shouldArchive: boolean;
  reasons: string[];
}

// ---- Time-aware search ----

export interface TimeFilter {
  from?: string;  // ISO date
  to?: string;    // ISO date
}

export interface SearchOptions {
  topK?: number;
  timeFilter?: TimeFilter;
  useSummarySearch?: boolean;
  retrievalMode?: 'reference' | 'enhanced';
  disableRewrite?: boolean;
  tagIds?: string[];
}
