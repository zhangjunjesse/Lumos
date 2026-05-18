/** 类目调研 run 状态：容器（任务列表）与报告面板共享，避免重复定义。 */
export type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const STATUS_LABEL: Record<RunStatus, string> = {
  pending: '排队中',
  running: '运行中',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
};

export function isNonTerminal(status: string): boolean {
  return status === 'pending' || status === 'running';
}
