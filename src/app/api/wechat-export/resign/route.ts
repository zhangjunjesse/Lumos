import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { NextResponse } from 'next/server';
import { hasValidConsent } from '@/lib/wechat-export/disclaimer';
import { runEnvProbes } from '@/lib/wechat-export/env-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);
const WECHAT_PROCESS_PATTERN = '/Applications/WeChat.app/Contents/MacOS/WeChat$';

function findWeChatPid(): number | null {
  try {
    const out = execFileSync(
      '/usr/bin/pgrep',
      ['-f', WECHAT_PROCESS_PATTERN],
      { encoding: 'utf8', timeout: 3000 },
    ).trim();
    const pid = parseInt(out.split(/\s+/)[0] || '', 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWeChatExit(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!findWeChatPid()) return true;
    await sleep(1000);
  }
  return !findWeChatPid();
}

async function waitForWeChatStart(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (findWeChatPid()) return true;
    await sleep(1000);
  }
  return !!findWeChatPid();
}

/**
 * POST /api/wechat-export/resign
 *
 * User-triggered repair step for WeChat Export. It gracefully quits WeChat,
 * asks macOS for administrator approval to ad-hoc sign WeChat, then reopens
 * WeChat so the user can extract any newly created database keys from inside
 * Lumos instead of copying terminal commands.
 */
export async function POST(): Promise<Response> {
  if (process.platform !== 'darwin') {
    return NextResponse.json({ error: 'macOS only' }, { status: 400 });
  }
  if (!hasValidConsent()) {
    return NextResponse.json({
      error: 'consent_required',
      message: '请先接受免责声明。',
    }, { status: 400 });
  }

  const env = runEnvProbes();
  if (!env.wechat.ok) {
    return NextResponse.json({
      error: 'wechat_not_found',
      message: env.wechat.detail || '未找到微信。',
    }, { status: 400 });
  }
  if (env.signed === 'adhoc') {
    try {
      execFileSync('/usr/bin/open', ['-a', 'WeChat'], { timeout: 5000 });
    } catch { /* best effort */ }
    const running = await waitForWeChatStart(30_000);
    return NextResponse.json({
      ok: true,
      signed: 'adhoc',
      opened: running,
      message: running
        ? '微信已经处于临时放开状态，接下来会重新提取消息库密钥。'
        : '微信已经处于临时放开状态，但还没有检测到微信主进程。请打开微信后重新提取密钥。',
    });
  }

  try {
    execFileSync('/usr/bin/osascript', [
      '-e',
      'tell application id "com.tencent.xinWeChat" to quit',
    ], { timeout: 5000 });
  } catch { /* WeChat may already be closed. */ }

  const exited = await waitForWeChatExit(20_000);
  if (!exited) {
    return NextResponse.json({
      error: 'wechat_still_running',
      message: '微信还没有退出。请先在微信里按 Command+Q 完全退出，然后再点一次修复按钮。',
    }, { status: 409 });
  }

  try {
    await execFileAsync('/usr/bin/osascript', [
      '-e',
      'do shell script "codesign --force --deep --sign - /Applications/WeChat.app" with administrator privileges',
    ], { timeout: 300_000 });
  } catch (err) {
    return NextResponse.json({
      error: 'resign_failed',
      message: err instanceof Error
        ? err.message
        : '临时放开微信读取保护失败。请确认已在系统弹窗里输入管理员密码。',
    }, { status: 500 });
  }

  try {
    execFileSync('/usr/bin/open', ['-a', 'WeChat'], { timeout: 5000 });
  } catch { /* best effort: user can still open it manually. */ }
  const running = await waitForWeChatStart(30_000);

  return NextResponse.json({
    ok: true,
    signed: 'adhoc',
    opened: running,
    message: running
      ? '已临时放开微信读取保护并重新打开微信，接下来会重新提取消息库密钥。'
      : '已临时放开微信读取保护，但还没有检测到微信主进程。请打开微信后重新提取密钥。',
  });
}
