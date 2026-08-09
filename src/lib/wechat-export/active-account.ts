/**
 * 「当前绑定的微信账号」——单一真源。
 *
 * 此前 Lumos 没有这个概念:哪个账号算"当前",要么取 windows_accounts.json 的
 * **第一条**(顺序取决于写入先后,纯属碰运气),要么按"谁的消息库 mtime 最新"猜。
 * 于是换号时必然出事 —— 新号刚登录、数据还少,mtime 猜不中,Lumos 就一直认着
 * 旧号:界面显示旧账号、点"重新检查"毫无变化、连"重新绑定"的入口都不出现
 * (那个入口的显示条件正是"检测到换号了")。用户被锁死,只能找开发。
 *
 * 所以把它显式化:绑定由**动作**产生(取密钥成功 / 用户手动指定目录),不靠猜。
 * 自动检测退位成"提示你可能换号了",不再决定任何数据归属。
 */

import fs from 'fs';
import path from 'path';
import { dataDir } from '@/lib/db';

/**
 * 惰性求值,且只依赖 dataDir —— 不 import setup-state。
 *
 * 两个理由。其一,顶层拼路径会把求值时机钉死在"本模块被 import 的那一刻",而
 * import 是提升的,谁先 import 谁就决定了拿到什么;这在测试里直接炸,在生产上
 * 是颗哑弹。其二,镜像库(mirror-db)要用这个模块定位当前账号,如果这里再去
 * import setup-state,就把整条 setup 状态机拖进了数据层的加载链 —— 依赖越长,
 * 越容易在某个 import 顺序下拿到半初始化的模块。
 */
export function activeAccountFile(): string {
  return path.join(dataDir, 'wechat-export', 'active_account.json');
}

function ensureDir(): void {
  const dir = path.dirname(activeAccountFile());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** 没有绑定账号时,mirror 数据落在这个名下(首次使用/清空之后)。 */
export const UNBOUND_ACCOUNT_KEY = 'default';

export interface BoundAccount {
  wxid: string;
  /** epoch ms,绑定发生的时刻。 */
  boundAt: number;
}

/**
 * wxid 会被用作文件名(每账号一个 mirror 库),所以必须挡住路径穿越。
 * 微信的 wxid 本身只有字母数字下划线连字符,超出这个集合的一律视为非法。
 */
function sanitizeWxid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

export function readBoundAccount(): BoundAccount | null {
  try {
    if (!fs.existsSync(activeAccountFile())) return null;
    const parsed = JSON.parse(fs.readFileSync(activeAccountFile(), 'utf8')) as Record<string, unknown>;
    const wxid = sanitizeWxid(parsed.wxid);
    if (!wxid) return null;
    return {
      wxid,
      boundAt: typeof parsed.boundAt === 'number' ? parsed.boundAt : 0,
    };
  } catch {
    return null;
  }
}

/** 当前账号的存储键。没绑定时回落到 default —— 调用方不必各自处理 null。 */
export function getActiveAccountKey(): string {
  return readBoundAccount()?.wxid ?? UNBOUND_ACCOUNT_KEY;
}

/**
 * 从既有配置补一次绑定(无感迁移)。
 *
 * 绑定是 0.39.28 才引入的,而 writeBoundAccount 只在「用户新做一次选择」时触发。
 * 于是老用户升级上来会卡在一个荒唐的状态:明明早就配好了数据目录、也取过密钥,
 * 界面却说"尚未绑定",还在旁边显示一个猜出来的账号 —— 用户当然会说"我明明配过了"。
 *
 * 这里把既有事实转成绑定,优先级从强到弱:
 *   ① 手动指定的数据目录解析出的 wxid —— 用户亲手选的,最强
 *   ② 取密钥时写下的账号记录 —— 也是事实,只是没记成绑定
 * 都没有就不动(真的没配过,该走正常引导)。
 *
 * @returns 补上的绑定;本来就有绑定或无从推断时返回 null
 */
export function backfillBoundAccount(input: {
  dataRootWxid?: string | null;
  keyedWxids?: string[];
}): BoundAccount | null {
  if (readBoundAccount()) return null;

  const fromDataRoot = sanitizeWxid(input.dataRootWxid);
  if (fromDataRoot) return writeBoundAccount(fromDataRoot);

  // 多个账号有密钥时不猜 —— 那是真有歧义,让用户自己点一下
  const keyed = (input.keyedWxids ?? []).map(sanitizeWxid).filter((v): v is string => Boolean(v));
  const unique = [...new Set(keyed)];
  return unique.length === 1 ? writeBoundAccount(unique[0]) : null;
}

/**
 * 绑定账号。取密钥成功、或用户手动选定数据目录时调用。
 * @returns 实际写入的绑定;wxid 非法时返回 null(不写)
 */
export function writeBoundAccount(wxid: unknown): BoundAccount | null {
  const clean = sanitizeWxid(wxid);
  if (!clean) return null;
  ensureDir();
  const next: BoundAccount = { wxid: clean, boundAt: Date.now() };
  fs.writeFileSync(activeAccountFile(), JSON.stringify(next, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return next;
}

export function clearBoundAccount(): void {
  try {
    fs.unlinkSync(activeAccountFile());
  } catch { /* 不存在即已达成目标 */ }
}

/**
 * 取密钥成功后确定绑定哪个账号。
 *
 * 密钥是从**正在运行的微信进程**内存里扫出来的,所以本次真正拿到密钥的那个账号
 * 就是用户当前登录的账号 —— 这比事后按文件 mtime 猜可靠得多。多条记录时取
 * extracted_at 最新的那条(历史账号的记录会留在同一个文件里)。
 */
export function bindAccountFromExtraction(
  accounts: Array<{ wxid?: string; key?: string; keys?: Record<string, string>; extracted_at?: number }>,
): BoundAccount | null {
  const hasKey = (a: { key?: string; keys?: Record<string, string> }) =>
    /^[0-9a-fA-F]{64}$/.test(a.key || '')
    || Object.values(a.keys || {}).some((v) => /^[0-9a-fA-F]{64}$/.test(v || ''));

  const candidate = accounts
    .filter((a) => sanitizeWxid(a.wxid) && hasKey(a))
    .sort((l, r) => (r.extracted_at ?? 0) - (l.extracted_at ?? 0))[0];

  return candidate ? writeBoundAccount(candidate.wxid) : null;
}
