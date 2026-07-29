/**
 * 把用户随手给的抖音输入解析成结构化字段。
 *
 * 支持的形态:
 *   - sec_uid 字符串("MS4wLjABAAAA...")
 *   - 主页链接:https://www.douyin.com/user/<sec_uid>
 *   - 抖音分享文案(里面夹着主页链接或短链)
 *   - 短链:https://v.douyin.com/<token>/(展开是后面的事)
 *   - 视频链接:https://www.douyin.com/video/<aweme_id>
 *   - 图文链接:https://www.douyin.com/note/<aweme_id>
 *   - 直播链接:https://live.douyin.com/<room_id>
 *   - 裸 aweme_id("76xxxxxxxxxxxxxxxxx")
 *
 * ## 为什么把「形态」和「内容类型」分开(#55)
 *
 * 这两件事是正交的:用户给的**形态**(短链 / 完整链接 / 裸 ID / 分享文案)和链接
 * 指向的**内容类型**(视频 / 图文 / 直播)互不决定。旧模型把它们乘在一起塞进一个
 * `kind`(`video-url`),于是图文只能再加 `note-url`、直播再加 `live-url`,
 * 短链还要配 `note-short-url`…… 组合会爆。
 *
 * 旧模型其实已经露了破绽:`short-url` 里没有内容类型 —— 因为短链不展开就不知道
 * 指向哪。这说明「类型待定」是个真实存在的状态,得能表达出来。
 *
 * 所以视频和图文合并成一个 `aweme`(它们在抖音后端本来就共用同一套 ID 体系),
 * 具体是哪种放在 `contentKind` 里;拿不准时是 `null`,由调用方去探测,而不是
 * 默认当视频 —— 旧代码里裸 ID 一律按视频处理,用户给一个图文的裸 ID 就会被
 * 静默送进视频链路。
 *
 * 短链展开成规范链接是上层(MCP / scraper)的事;这里只做纯字符串解析,不碰网络。
 */

/** 作品的内容类型。视频与图文共用 aweme_id 体系,裸 ID 时区分不了 → null。 */
export type DouyinContentKind = 'video' | 'note';

export type ParsedDouyinInput =
  | { kind: 'sec_uid'; secUid: string; original: string }
  | { kind: 'profile-url'; secUid: string; original: string }
  /** 一条作品。contentKind 为 null 表示还判定不出是视频还是图文。 */
  | { kind: 'aweme'; awemeId: string; contentKind: DouyinContentKind | null; original: string }
  | { kind: 'live'; roomId: string; original: string }
  | { kind: 'short-url'; shortToken: string; original: string }
  | { kind: 'unknown'; original: string };

const SEC_UID_RE = /^[A-Za-z0-9_-]{20,}$/;
const AWEME_ID_RE = /^\d{15,21}$/;
const DOUYIN_URL_IN_TEXT_RE =
  /(?:https?:\/\/)?(?:www\.|m\.|v\.)?(?:douyin\.com|iesdouyin\.com)\/[^\s<>"'，。！？；、]+/i;

export function parseDouyinInput(raw: string): ParsedDouyinInput {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { kind: 'unknown', original: raw ?? '' };

  if (SEC_UID_RE.test(trimmed) && trimmed.startsWith('MS')) {
    return { kind: 'sec_uid', secUid: trimmed, original: trimmed };
  }
  if (AWEME_ID_RE.test(trimmed)) {
    // 光看 ID 认不出是视频还是图文 —— 两者同一套体系。留 null 让上层去探测。
    return { kind: 'aweme', awemeId: trimmed, contentKind: null, original: trimmed };
  }

  const candidate = normalizeDouyinUrlCandidate(trimmed);
  let url: URL | null = null;
  try {
    url = new URL(candidate);
  } catch {
    url = null;
  }
  if (!url) return { kind: 'unknown', original: trimmed };

  const host = url.hostname.toLowerCase();

  if (host === 'v.douyin.com') {
    const token = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    // 短链只有展开才知道指向视频还是图文,这里不猜。
    if (token) return { kind: 'short-url', shortToken: token, original: trimmed };
  }

  if (host === 'live.douyin.com') {
    const roomId = url.pathname.split('/').filter(Boolean)[0] ?? '';
    // 直播采集器不支持,但必须认出来 —— 否则又会回「需要视频链接」这种错话。
    if (roomId) return { kind: 'live', roomId, original: trimmed };
  }

  if (
    host === 'www.douyin.com' ||
    host === 'douyin.com' ||
    host === 'm.douyin.com' ||
    host === 'www.iesdouyin.com' ||
    host === 'iesdouyin.com'
  ) {
    const segments = url.pathname.split('/').filter(Boolean);
    const userIdx = findPathSegments(segments, ['user']) ?? findPathSegments(segments, ['share', 'user']);
    if (userIdx !== null && segments[userIdx + 1]) {
      const secUid = segments[userIdx + 1].split('?')[0];
      if (SEC_UID_RE.test(secUid)) {
        return { kind: 'profile-url', secUid, original: trimmed };
      }
    }

    const aweme = matchAwemePath(segments);
    if (aweme) {
      return { kind: 'aweme', ...aweme, original: trimmed };
    }

    const liveIdx = findPathSegments(segments, ['live']) ?? findPathSegments(segments, ['share', 'live']);
    if (liveIdx !== null && segments[liveIdx + 1]) {
      const roomId = segments[liveIdx + 1].split('?')[0];
      if (roomId) return { kind: 'live', roomId, original: trimmed };
    }
  }

  return { kind: 'unknown', original: trimmed };
}

/**
 * 从解析结果里取作品 ID;指向的不是一条作品(主页 / 直播 / 未展开的短链 / 认不出)
 * 时返回 null。
 *
 * 这个判断原先在 6 处各写了一遍 `kind === 'video-url' || kind === 'aweme_id'`
 * —— 加一种内容类型就要同步改 6 个地方,#55 正是漏改的结果。只留这一处。
 */
export function getAwemeId(parsed: ParsedDouyinInput): string | null {
  return parsed.kind === 'aweme' ? parsed.awemeId : null;
}

/**
 * 把作品 ID 拼回规范链接。
 *
 * 这个串会被存成 job 的 target_ref,之后又用 parseDouyinInput 读回来 —— 是个往返
 * 载体,所以必须能原样还原内容类型。旧代码无条件拼 `/video/`,于是图文存进去、
 * 读出来就变成了视频(#55)。
 *
 * 类型没判出来时**返回裸 ID**,不拼 `/video/` —— 拼了就是凭空捏造一个类型,
 * 下游再也没机会知道这里其实没判过。
 */
export function buildAwemeRef(awemeId: string, contentKind: DouyinContentKind | null): string {
  if (contentKind === 'note') return `https://www.douyin.com/note/${awemeId}`;
  if (contentKind === 'video') return `https://www.douyin.com/video/${awemeId}`;
  return awemeId;
}

/** 路径段里找作品 ID。/video/ 与 /note/ 结构一致,只是内容类型不同。 */
const AWEME_PATH_KINDS: ReadonlyArray<{ segment: string; contentKind: DouyinContentKind }> = [
  { segment: 'video', contentKind: 'video' },
  { segment: 'note', contentKind: 'note' },
];

function matchAwemePath(
  segments: string[],
): { awemeId: string; contentKind: DouyinContentKind } | null {
  for (const { segment, contentKind } of AWEME_PATH_KINDS) {
    const idx = findPathSegments(segments, [segment]) ?? findPathSegments(segments, ['share', segment]);
    if (idx === null || !segments[idx + 1]) continue;
    const awemeId = segments[idx + 1].split('?')[0];
    if (AWEME_ID_RE.test(awemeId)) return { awemeId, contentKind };
  }
  return null;
}

function normalizeDouyinUrlCandidate(input: string): string {
  const matched = input.match(DOUYIN_URL_IN_TEXT_RE)?.[0] ?? input;
  const stripped = matched.replace(/[，。！？；、,.)\]}>"']+$/u, '');
  return /^https?:\/\//i.test(stripped) ? stripped : `https://${stripped}`;
}

function findPathSegments(segments: string[], pattern: string[]): number | null {
  for (let idx = 0; idx <= segments.length - pattern.length; idx += 1) {
    const matches = pattern.every((part, offset) => segments[idx + offset] === part);
    if (matches) return idx + pattern.length - 1;
  }
  return null;
}
