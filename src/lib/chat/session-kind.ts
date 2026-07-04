/**
 * 会话身份的单一真源。
 *
 * 历史做法把身份水印（`__LUMOS_*__` 魔法标记）埋进 `system_prompt`，判定靠
 * `system_prompt.includes(marker)` + 标题兜底，散在 8 个 *-session.ts 里。三个
 * 后果：非 main-agent 标记随 system_prompt 原样发给模型（token 噪声）、改标题能
 * 翻转专属会话工具权限、身份这类结构事实用提示词文本承载。
 *
 * 现在身份是 `chat_sessions.kind` 一列。本模块是它的类型 + 判定/清洗纯函数，
 * **零重依赖**（只 import 类型）——迁移（db 层）与运行时（chat 层）共用它而不
 * 触发 db→chat 循环。marker/title 常量仅用于「把历史数据回填成 kind 列」，新建
 * 会话不再写 marker。
 */
export type SessionKind =
  | 'chat'
  | 'main-agent'
  | 'workflow'
  | 'wechat-assistant'
  | 'ecommerce-assistant'
  | 'library'
  | 'app-builder'
  | 'creation'
  | 'goofish-assistant';

/**
 * 历史身份标记。仅用于回填/剥离（inferSessionKind / stripSessionMarkers）。
 * 新建会话不再写入这些——身份走 kind 列。
 */
export const SESSION_MARKERS: Record<Exclude<SessionKind, 'chat'>, string> = {
  'main-agent': '__LUMOS_MAIN_AGENT__',
  workflow: '__LUMOS_WORKFLOW_CHAT__',
  'wechat-assistant': '__LUMOS_WECHAT_ASSISTANT_CHAT__',
  'ecommerce-assistant': '__LUMOS_ECOMMERCE_ASSISTANT_CHAT__',
  library: '__LUMOS_LIBRARY_CHAT__',
  'app-builder': '__LUMOS_APP_BUILDER_CHAT__',
  creation: '__LUMOS_ETSY_CREATION_CHAT__',
  'goofish-assistant': '__LUMOS_GOOFISH_ASSISTANT_CHAT__',
};

/** 专属会话展示标题（也是老会话的身份兜底键）。 */
export const SESSION_TITLES = {
  workflow: '工作流 AI 助手',
  'wechat-assistant': '微信助手 AI 对话',
  'ecommerce-assistant': '电商助手 AI 对话',
  library: '资料库 AI 对话',
  'app-builder': '应用开发助手',
  creation: '创作区 AI 对话',
  'goofish-assistant': '闲鱼助手 AI 对话',
} as const;

/** 老 library 会话在标记机制之前的正文特征串，配合标题做兜底判定。 */
export const LIBRARY_CHAT_LEGACY_FRAGMENT =
  'dedicated assistant for the knowledge library page';

const ALL_MARKERS: readonly string[] = Object.values(SESSION_MARKERS);

/**
 * 从（历史）system_prompt + 标题推断会话 kind。
 *
 * 逐字复现迁移前散在各 *-session.ts 的判定，保证回填结果 == 迁移前运行时身份、
 * 零行为漂移：
 * - marker 优先（互斥、精确）。
 * - 无 marker 时才用标题兜底，且只对本就有标题兜底的类型
 *   （wechat / ecommerce / goofish / library）——workflow / app-builder /
 *   creation / main-agent 历史上从不靠标题判定，这里也不加。
 */
export function inferSessionKind(
  systemPrompt: string | null | undefined,
  title: string | null | undefined,
): SessionKind {
  const prompt = String(systemPrompt || '');
  for (const [kind, marker] of Object.entries(SESSION_MARKERS)) {
    if (prompt.includes(marker)) return kind as SessionKind;
  }
  const t = String(title || '').trim();
  if (t === SESSION_TITLES['wechat-assistant']) return 'wechat-assistant';
  if (t === SESSION_TITLES['ecommerce-assistant']) return 'ecommerce-assistant';
  if (t === SESSION_TITLES['goofish-assistant']) return 'goofish-assistant';
  if (t === SESSION_TITLES.library && prompt.includes(LIBRARY_CHAT_LEGACY_FRAGMENT)) {
    return 'library';
  }
  return 'chat';
}

/**
 * 删掉 system_prompt 里独占整行的历史身份标记（各 build*SystemPrompt 都以
 * `[MARKER, ...].join('\n')` 拼接，marker 恒独占一行）。按 trim 后精确整行匹配，
 * 不碰其他内容——防御性、可对历史脏数据幂等运行。
 */
export function stripSessionMarkers(systemPrompt: string | null | undefined): string {
  return String(systemPrompt || '')
    .split('\n')
    .filter((line) => !ALL_MARKERS.includes(line.trim()))
    .join('\n')
    .replace(/^\n+/, '');
}

/** 读会话 kind；缺列时退化为 'chat'（防御旧对象）。 */
export function getSessionKind(session?: { kind?: SessionKind | null } | null): SessionKind {
  return session?.kind || 'chat';
}
