// Shared types for Etsy Forge — Lumos 内置应用 "Etsy AI 出图"
// 所有 lib / api / UI 共用。data-schema.json 是真源，本文件是 TS 视角的窄类型。

export type ImageSourceType = 'generated' | 'remixed';
export type RemixAction = 'recolor' | 'restyle' | 'resubject' | 'series' | 'resize' | 'removebg';
export type TasteStage = 'cold_start' | 'mixed' | 'main';
export type RunKind = 'push_batch' | 'remix_batch' | 'refresh_signals' | 'export' | 'self_check';
export type RunStatus = 'running' | 'success' | 'failed' | 'cancelled' | 'partial';
export type SignalsStatus = 'fresh' | 'stale' | 'failed';
export type PushSource = 'cold_start' | 'preference' | 'trend' | 'random';

export interface PaletteHex {
  hex: string[];
  weight?: number;
}

export interface ThemeCard {
  theme: string;
  weight?: number;
  growth?: number;
  competition?: number;
}

export interface WeeklySignals {
  rising_themes: ThemeCard[];
  color_trends: PaletteHex[];
  composition_trends: Array<{ type: string; weight: number }>;
  category_trends: Array<{ category: string; weight: number }>;
  fetched_at: string;
  valid_until: string;
  status: SignalsStatus;
  failure_reason?: string;
  source_summary?: string;
}

export interface TasteProfile {
  version: number;
  signal_count: number;
  stage: TasteStage;
  liked_themes: Array<{ theme: string; weight: number }>;
  liked_styles: Array<{ style: string; weight: number }>;
  liked_palettes: PaletteHex[];
  disliked_themes: Array<{ theme: string; weight: number }>;
  last_recomputed_at?: string;
}

export interface PushSlot {
  theme: string;
  style: string;
  palette: string[];
  composition: string;
  format: string;
  source: PushSource;
}

export interface ImageRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  source_type: ImageSourceType;
  parent_image_id?: string;
  remix_action?: RemixAction | '';
  prompt_used: string;
  theme: string;
  style: string;
  palette: string;
  composition: string;
  file_path: string;
  cloud_url?: string;
  thumbnail_path?: string;
  width: number;
  height: number;
  in_library: boolean;
  batch_id?: string;
  fingerprint?: string;
  ai_generated_tag: boolean;
  created_at: string;
}

export interface TasteSignalRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  image_id: string;
  signal: 1 | -1;
  theme?: string;
  style?: string;
  palette?: string;
  created_at: string;
}

export interface RunRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  kind: RunKind;
  themes_json: string;
  strategy: TasteStage;
  generated_count: number;
  succeeded_count: number;
  failed_count: number;
  liked_count: number;
  quota_spent: number;
  status: RunStatus;
  failure_reason?: string;
  started_at: string;
  ended_at?: string;
}

export interface AppSettings extends Record<string, unknown> {
  ai_system_prompt: string;
  risk_note: string;
  batch_size: number;
  prefetch_at_index: number;
  concurrency_per_batch: number;
  min_signals_for_main_strategy: number;
  min_signals_for_mixed_strategy: number;
  dedup_cosine_threshold: number;
  printful_account?: string;
  printful_oauth_token?: string;
  auto_tag_ai_generated: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  ai_system_prompt:
    'Generate ORIGINAL Etsy POD designs only. Strictly avoid copyrighted characters, brands, celebrities, and trademarked logos. Optimize for print: clean edges, high contrast, transparent or simple background. No melting faces, extra fingers, random text, signatures, or watermarks. Single focal subject works at both T-shirt-pocket and poster scale.',
  risk_note:
    '不爬同行图、不做他人图的二创、不自动上架到 Etsy。导出/上架时按 Etsy 2024 新规自动标 AI 生成（不标会被封店）。清空图库 / 重置审美档案 / 重新拉取趋势数据需二次确认。',
  batch_size: 50,
  prefetch_at_index: 30,
  concurrency_per_batch: 5,
  min_signals_for_main_strategy: 50,
  min_signals_for_mixed_strategy: 10,
  dedup_cosine_threshold: 0.85,
  auto_tag_ai_generated: true,
};

// Etsy POD 通用合规守则（注入所有生图 prompt）
export const ORIGINAL_DESIGN_GUARDRAILS = [
  'Original artwork only — NO references to existing characters, brands, copyrighted material, celebrities, or trademarked logos.',
  'Suitable for Print-on-Demand: high contrast, clean edges, simple background or transparent.',
  'Avoid generic AI aesthetics: no melting faces, no extra fingers, no random text or watermarks, no signature.',
  'Single focal subject; design works at small size (T-shirt chest pocket) and large size (poster).',
];

export const COLLECTIONS = {
  IMAGES: 'etsy_forge_images',
  SIGNALS: 'etsy_forge_taste_signals',
  PROFILE: 'etsy_forge_taste_profile',
  RUNS: 'etsy_forge_runs',
  WEEKLY: 'etsy_forge_weekly_signals',
  APP_SETTINGS: 'app_settings',
  RUN_HISTORY: 'run_history',
} as const;
