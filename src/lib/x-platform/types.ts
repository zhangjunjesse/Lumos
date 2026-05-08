/**
 * X (Twitter) 模块共享类型。和 goofish 模块对齐: 一处定义,多处复用,
 * 防止 API 路由 / UI / MCP 三层定义漂移。
 */

export interface XAuthStatus {
  loggedIn: boolean;
  /** 数字字符串。来自 cookie twid="u=<id>"。未登录时为空。 */
  userId: string;
  /** @ 句柄(无 @ 前缀)。来自 viewer GraphQL 查询。 */
  screenName: string;
  /** 显示昵称。 */
  name: string;
}

export interface XSearchHit {
  id: string;
  authorId: string;
  authorScreenName: string;
  authorName: string;
  text: string;
  createdAt: number;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  url: string;
}

export interface XSearchResult {
  query: string;
  hits: XSearchHit[];
  cursor?: string;
}

export interface XTweet {
  id: string;
  text: string;
  createdAt: number;
  url: string;
}

export interface XTimelineItem extends XSearchHit {
  /** Optional reply chain head for thread context. */
  replyToTweetId?: string;
}
