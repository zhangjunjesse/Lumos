import { parseDouyinInput, type DouyinContentKind } from './parse-input';
import { resolveShortLink } from './scraper';

export type ResolveCreatorOutcome =
  | { ok: true; secUid: string }
  | {
      ok: false;
      code:
        | 'empty'
        | 'video-link'
        | 'short-link-unreachable'
        | 'short-link-video'
        | 'short-link-unrecognized'
        | 'unrecognized';
      message: string;
    };

/**
 * Resolve a free-form creator input (sec_uid / profile URL / v.douyin.com
 * short link / nickname / garbage) to a canonical sec_uid the collector
 * job can actually run against. Short links are resolved synchronously
 * here — saving creator rows with sec_uid=null only produces zombie
 * subscriptions that fail every collect_job with "请先编辑博主条目",
 * but the UI has no edit affordance, so the user gets stuck.
 */
export async function resolveCreatorInput(raw: string): Promise<ResolveCreatorOutcome> {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { ok: false, code: 'empty', message: '需要输入博主主页链接或 sec_uid。' };
  }

  const parsed = parseDouyinInput(trimmed);
  if (parsed.kind === 'sec_uid' || parsed.kind === 'profile-url') {
    return { ok: true, secUid: parsed.secUid };
  }
  if (parsed.kind === 'aweme') {
    return {
      ok: false,
      code: 'video-link',
      message: `看起来是${describeAwemeKind(parsed.contentKind)}链接，`
        + '请改到「采集任务」按链接采集，或填博主主页链接。',
    };
  }
  if (parsed.kind === 'short-url') {
    const resolved = await resolveShortLink(parsed.shortToken);
    if (!resolved) {
      return {
        ok: false,
        code: 'short-link-unreachable',
        message: `短链解析失败：v.douyin.com/${parsed.shortToken} 不可达。请在浏览器打开短链拿到主页 URL（www.douyin.com/user/...）再粘贴。`,
      };
    }
    const reparsed = parseDouyinInput(resolved);
    if (reparsed.kind === 'sec_uid' || reparsed.kind === 'profile-url') {
      return { ok: true, secUid: reparsed.secUid };
    }
    if (reparsed.kind === 'aweme') {
      return {
        ok: false,
        code: 'short-link-video',
        message: `短链指向${describeAwemeKind(reparsed.contentKind)}而不是博主主页。`
          + '请到「采集任务」按链接采集。',
      };
    }
    return {
      ok: false,
      code: 'short-link-unrecognized',
      message: `短链解析后仍无法识别为博主主页：${resolved}`,
    };
  }

  return {
    ok: false,
    code: 'unrecognized',
    message:
      '识别不出博主主页或 sec_uid。请到抖音 App 点博主头像 → 分享 → 复制链接，得到 v.douyin.com/... 或 www.douyin.com/user/... 后粘贴。纯昵称无法直接订阅。',
  };
}

/** 提示语里怎么称呼这条作品。类型没判出来时说"作品",别硬猜成"视频"(#55)。 */
function describeAwemeKind(contentKind: DouyinContentKind | null): string {
  if (contentKind === 'note') return '图文';
  if (contentKind === 'video') return '视频';
  return '作品';
}
