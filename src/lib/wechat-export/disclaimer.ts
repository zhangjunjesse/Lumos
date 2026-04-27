/**
 * WeChat export feature — disclaimer text + consent persistence.
 *
 * The full disclaimer body lives below as a single Markdown string. We hash it
 * (SHA-256) so any wording change forces existing users through a fresh
 * consent flow — auditable proof that the user accepted *this exact* version.
 *
 * Consent is stored in the SQLite `settings` table (which Lumos already uses
 * for app-level config) under three keys; nothing is written to the network.
 */
import crypto from 'crypto';
import { getSetting, setSetting } from '@/lib/db';

export const DISCLAIMER_VERSION = 'v1';
export const DISCLAIMER_EFFECTIVE_AT = '2026-04-27';

/** Short summary shown above the [展开完整声明] toggle in the wizard. */
export const DISCLAIMER_SUMMARY: ReadonlyArray<string> = [
  '微信用户协议不允许此类操作 — 启用属于你的个人选择,腾讯有可能据此封禁微信账号。',
  '数据完全本地处理 — 聊天记录只在你这台 mac 上解密,不会上传 lumos 云端、不会发给第三方,除非你主动让 AI 引用其内容回答问题。',
  '仅限你自己的账号 — 不得用于他人账号(经授权除外)、群发、商业数据转售。法律责任由你自负。',
  'setup 期间临时影响系统权限 — 5-15 分钟内截屏 / 录屏 / 辅助功能可能失效,setup 完成后会引导你恢复,之后永久正常。',
];

/** Full disclaimer body (Markdown). Hash this for re-consent on changes. */
export const DISCLAIMER_BODY = `# 微信导出能力 · 用户须知与免责声明 (v1)

生效:${DISCLAIMER_EFFECTIVE_AT}
适用:Lumos 桌面端 macOS 平台「微信导出」(WeChat Export) 能力

## 一、什么是这个能力

Lumos 在你的 mac 本地解密微信加密数据库,让 AI 助手能读取你的聊天记录用于
回答问题、整理摘要、查找信息等。

## 二、技术机制简述

启用过程中,Lumos 会:
  1. 临时改变 /Applications/WeChat.app 的代码签名(adhoc),使得调试器(lldb)
     能读取微信进程内存。
  2. 从微信进程内存中提取 SQLCipher 加密密钥(64 位十六进制)。
  3. 用密钥 + sqlcipher 工具读取微信数据库文件。
  4. 引导你从 App Store 恢复微信原签名。

数据库文件路径:
  ~/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/
  <wxid>/db_storage/

## 三、合规与风险

### 3.1 微信用户协议
《腾讯微信软件许可及服务协议》及相关附件中,通常包含禁止"对软件本身、
软件运行过程中的数据进行修改、反编译、解密"等条款。**启用本能力可能违反
上述协议。**

### 3.2 可能的后果
  - 腾讯有权以违反协议为由,单方面**封禁、限制或注销**你的微信账号。Lumos
    暂未观察到因使用此类工具被封号的案例,但**不能排除腾讯未来主动追溯**。
  - 在中国大陆,《个人信息保护法》《数据安全法》《网络安全法》对个人数据
    处理有明确规定。**仅处理你本人合法授权范围内的数据**。

### 3.3 系统权限变化(macOS)
启用流程涉及 sudo codesign 命令,这会:
  - 临时让微信失去 macOS Hardened Runtime 保护;
  - 临时使微信原本获得的隐私权限(屏幕录制、辅助功能、剪贴板等)失效,
    直到你重装微信恢复签名。

详情见 setup wizard 第 5 步「恢复微信原签名」。

## 四、Lumos 的位置

  - Lumos 仅提供工具,**不主动收集你的微信数据**。
  - 数据库密钥与解密结果存储在 ~/.lumos/wechat-export/,不上传任何 Lumos
    服务器。
  - 当你向 AI 提问需要引用微信内容时,**仅当次提问涉及的片段**会被发送到
    你配置的 AI 服务商(如 Anthropic、OpenAI 或自托管模型);未被引用的
    内容不会发送。
  - Lumos **不对**因启用本能力造成的微信账号封禁、法律责任、第三方索赔
    等任何后果**承担责任**。
  - 你保留随时禁用 / 完全卸载本能力的权利,卸载会删除
    ~/.lumos/wechat-export/ 下所有数据。

## 五、记录与撤回

  - 你接受本声明的时间戳与版本号会记录在 Lumos 本地数据库的
    settings 表(不上传)。
  - Lumos 后续修订本声明时(版本号变化),会再次要求你接受;不接受不影响
    微信导出能力的关闭使用。

## 六、不接受的情况

如果你不能接受上述任何一项,请直接关闭此对话框,不要勾选任何选项。Lumos
的其他能力不受影响。

──
本声明由 Lumos 项目维护,内容可能随版本更新。
当前生效版本可在「设置 → 关于 → 法律声明」中查阅。
`;

const DISCLAIMER_HASH = crypto
  .createHash('sha256')
  .update(DISCLAIMER_BODY, 'utf8')
  .digest('hex');

export function getDisclaimerHash(): string {
  return DISCLAIMER_HASH;
}

// settings table keys
const KEY_VERSION = 'wechat_export_consent_version';
const KEY_HASH = 'wechat_export_consent_hash';
const KEY_AT = 'wechat_export_consent_at';

export interface ConsentRecord {
  version: string;
  hash: string;
  acceptedAt: string;
}

/** Returns the current stored consent record, or null if not yet accepted. */
export function getConsent(): ConsentRecord | null {
  const version = getSetting(KEY_VERSION);
  const hash = getSetting(KEY_HASH);
  const acceptedAt = getSetting(KEY_AT);
  if (!version || !hash || !acceptedAt) return null;
  return { version, hash, acceptedAt };
}

/** True iff the user already accepted *this exact* disclaimer version + body. */
export function hasValidConsent(): boolean {
  const record = getConsent();
  if (!record) return false;
  return record.version === DISCLAIMER_VERSION && record.hash === DISCLAIMER_HASH;
}

/** Persist user's acceptance. Idempotent. */
export function recordConsent(): ConsentRecord {
  const record: ConsentRecord = {
    version: DISCLAIMER_VERSION,
    hash: DISCLAIMER_HASH,
    acceptedAt: new Date().toISOString(),
  };
  setSetting(KEY_VERSION, record.version);
  setSetting(KEY_HASH, record.hash);
  setSetting(KEY_AT, record.acceptedAt);
  return record;
}

/** Clear the consent record (e.g. when user fully uninstalls the feature). */
export function revokeConsent(): void {
  setSetting(KEY_VERSION, '');
  setSetting(KEY_HASH, '');
  setSetting(KEY_AT, '');
}
