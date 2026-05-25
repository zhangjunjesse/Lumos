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
  /** Impressions / views — 老接口没有,有则填,没有 0。 */
  viewCount: number;
  /** Bookmark/收藏 数。X 偶尔通过不同字段返回,无值 = 0。 */
  bookmarkCount: number;
  /** 引用转发数(quote tweet)。 */
  quoteCount: number;
  /** Same thread 的根推 ID(thread head)。和 id 相同表示自己是头条。 */
  conversationId: string;
  /** 媒体 URL 列表(图片直链)。 */
  photoUrls: string[];
  /** 视频 preview 缩略图 URL 列表(实际视频流 X 走 m3u8,这里只存预览图)。 */
  videoPreviewUrls: string[];
  url: string;
}

export interface XSearchResult {
  query: string;
  hits: XSearchHit[];
  cursor?: string;
  requestedCount?: number;
  returnedCount?: number;
  maxSupportedCount?: number;
  partial?: boolean;
  timedOut?: boolean;
  durationMs?: number;
  error?: string;
}

export interface XCollectionMeta {
  requestedCount: number;
  returnedCount: number;
  maxSupportedCount: number;
  partial: boolean;
  timedOut: boolean;
  durationMs: number;
  error?: string;
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
