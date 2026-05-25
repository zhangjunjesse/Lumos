/**
 * X 雷达 UI 共享类型。RadarKind 仍由 NewTaskDialog 导出（保持兼容）。
 */
import type { RadarKind } from './NewTaskDialog';

export interface RadarTaskRow {
  id: string;
  name?: string;
  kind?: RadarKind;
  enabled?: boolean;
  cadence?: string;
  config_json?: string;
  last_status?: string;
  last_summary?: string;
  last_failure_reason?: string;
  last_run_started_at?: string;
  next_run_at?: string;
  im_enabled?: boolean;
  im_target_label?: string;
}
