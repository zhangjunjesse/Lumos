// 输入认不出 / 不支持时,说清楚到底是什么(#55)。
//
// 病史:图文 note 落进 unknown 之后,各处一律回一句「需要抖音视频链接、短链或纯
// aweme_id」。用户看了只会以为自己链接给错了,而真相是"这类内容采集器不支持" ——
// 因果方向是反的,#55 的报告人就是因此绕了一大圈,最后自己写了个 Skill 兜底。
//
// 所以诊断必须回答两件事:识别到的是什么(type)、为什么走不下去(reason),
// 而不是把所有失败都塞进同一句话。

import type { ParsedDouyinInput } from './parse-input';

export type UnsupportedInputReason =
  /** 认出来了,但采集器不处理这类内容(直播等)。 */
  | 'unsupported-content-type'
  /** 认出来了,但它指向博主而不是一条作品。 */
  | 'not-a-content-link'
  /** 短链没展开,类型还判不出来。 */
  | 'short-link-unresolved'
  /** 压根没认出是抖音的东西。 */
  | 'unrecognized-input';

export interface UnsupportedInput {
  reason: UnsupportedInputReason;
  /** 识别到的内容类型;认不出时是 'unknown'。 */
  type: string;
  /** 给用户看的人话。 */
  message: string;
}

/**
 * 解释一个「取不到作品 ID」的解析结果。
 *
 * 调用前提是 {@link getAwemeId} 已经返回 null —— 传一条正常作品进来会得到
 * unrecognized,那说明调用方用错了。
 */
export function describeUnsupportedInput(parsed: ParsedDouyinInput): UnsupportedInput {
  switch (parsed.kind) {
    case 'live':
      return {
        reason: 'unsupported-content-type',
        type: 'live',
        message: '这是抖音直播链接，采集器只处理已发布的视频和图文，不支持直播。',
      };
    case 'sec_uid':
    case 'profile-url':
      return {
        reason: 'not-a-content-link',
        type: 'user',
        message: '这是博主主页链接，不是一条作品。要采这个博主请用「按博主采集」。',
      };
    case 'short-url':
      return {
        reason: 'short-link-unresolved',
        type: 'unknown',
        message: `短链 v.douyin.com/${parsed.shortToken} 没能展开，无法判断内容类型。`
          + '请在浏览器打开这条短链，把跳转后的完整链接粘进来。',
      };
    case 'aweme':
      // 走到这儿说明调用方在 getAwemeId 还给得出 ID 的情况下当成了失败。
      return {
        reason: 'unrecognized-input',
        type: parsed.contentKind ?? 'unknown',
        message: '内容已识别，但调用方没有取用作品 ID，这是程序内部错误。',
      };
    default:
      return {
        reason: 'unrecognized-input',
        type: 'unknown',
        message: '认不出这是抖音的什么内容。支持:视频链接、图文链接、分享文案里的短链、'
          + '纯 aweme_id、博主主页链接。',
      };
  }
}
