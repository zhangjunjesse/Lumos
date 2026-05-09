export interface EcommerceProviderCheck {
  ok: boolean;
  name?: string;
  reason?: string;
}

export interface EcommerceAssistantStatus {
  app: { id: string; name: string; version: string; source: string; status: string };
  install: { installed: boolean; version: string | null; error: string | null };
  providers: { analysis: EcommerceProviderCheck; image: EcommerceProviderCheck };
  inventory: {
    ready: boolean;
    inputCount: number;
    runningJobs: number;
    storeError: string | null;
  };
  lastJob: {
    id: string;
    status: string;
    stage: string | null;
    progress: number | null;
    updatedAt: string | null;
    failureReason: string | null;
  } | null;
  ready: boolean;
  phase: string;
}

export interface ProductInput {
  id: string;
  title: string;
  category_hint?: string | null;
  main_image_path: string;
  reference_image_paths?: string | null;
  note?: string | null;
  status: 'ready' | 'archived';
  updated_at?: string | null;
  created_at?: string | null;
}

export interface ImageJob {
  id: string;
  input_id: string;
  preset_id?: string | null;
  aspect_ratio?: string | null;
  status: string;
  stage?: string | null;
  progress?: number | null;
  cutout_path?: string | null;
  final_image_path?: string | null;
  winner_direction?: string | null;
  fallback_used?: boolean | null;
  cutout_attempts?: number | null;
  scene_attempts?: number | null;
  refine_attempts?: number | null;
  failure_reason?: string | null;
  failure_stage?: string | null;
  summary?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface ImageOutput {
  id: string;
  job_id: string;
  kind: 'cutout' | 'catalog' | 'lifestyle' | 'campaign' | 'final' | 'fallback';
  iteration?: number | null;
  image_path: string;
  qc_pass?: boolean | null;
  qc_summary?: string | null;
  qc_fail_reason?: string | null;
  is_winner?: boolean | null;
  prompt?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface StylePreset {
  id: string;
  name: string;
  direction: 'catalog' | 'lifestyle' | 'campaign' | 'custom';
  scene?: string | null;
  composition?: string | null;
  lighting?: string | null;
  mood?: string | null;
  negative_rules?: string | null;
  is_builtin?: boolean | null;
  enabled?: boolean | null;
}

export type EcommerceTab = 'overview' | 'studio' | 'jobs' | 'library' | 'presets' | 'settings';
