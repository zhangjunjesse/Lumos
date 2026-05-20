// 每日复盘 UI 侧类型（纯类型，client 安全，不引服务端 store）。
// 每日复盘 = 当天会话列表，每条带基本信息 + 总结，可点开看对话详情。

export type ReviewStatus = "ok" | "empty" | "unavailable" | "error";

export interface DigestEvent {
  id: string; // 需求唯一编号（服务端确定性生成）
  requirement: string; // 需求
  process: string; // 执行过程
  outcome: string; // 结果
  shortcomings: string[]; // 不足
}

export type DigestInsightType = "用户偏好" | "经验" | "能力缺口";

export interface DigestInsight {
  id: string; // 洞察唯一编号（服务端确定性生成）
  type: DigestInsightType;
  content: string;
}

export interface SessionDigest {
  events: DigestEvent[];
  insights: DigestInsight[];
}

export interface SourceSession {
  id: string;
  title: string;
  messageCount: number;
  digest: SessionDigest | null;
}

export interface DailyReview {
  id: string;
  reviewDay: string;
  status: ReviewStatus;
  triggerType: string;
  sessionCount: number;
  truncated: boolean;
  model: string;
  sourceSessions: SourceSession[];
  error: string;
  completedAt: string;
}
