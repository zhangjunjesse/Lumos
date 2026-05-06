import { NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import { hasValidConsent } from '@/lib/wechat-export/disclaimer';
import { getWindowsWeChatProcessNames, runEnvProbes } from '@/lib/wechat-export/env-check';
import { extractKeys, type KeyExtractionProgress } from '@/lib/wechat-export/key-extractor';
import { getWeChatExportPlatform } from '@/lib/wechat-export/setup-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function findWeChatPid(): number | null {
  try {
    // pgrep -f filters by full command line; we want the main `WeChat` exe,
    // not any of the helper subprocesses (WeChatAppEx, renderer, gpu).
    const out = execFileSync(
      '/usr/bin/pgrep',
      ['-f', '/Applications/WeChat.app/Contents/MacOS/WeChat$'],
      { encoding: 'utf8', timeout: 3000 },
    ).trim();
    const pid = parseInt(out.split(/\s+/)[0] || '', 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function findWindowsWeChatPid(): number | null {
  try {
    for (const processName of getWindowsWeChatProcessNames()) {
      const out = execFileSync('tasklist', [
        '/FI',
        `IMAGENAME eq ${processName}`,
        '/FO',
        'CSV',
        '/NH',
      ], { encoding: 'utf8', timeout: 3000 }).trim();
      for (const line of out.split(/\r?\n/)) {
        if (!line.toLowerCase().includes(processName.toLowerCase())) continue;
        const fields = line.split('","').map((part) => part.replace(/^"|"$/g, ''));
        const pid = parseInt(fields[1] || '', 10);
        if (Number.isFinite(pid) && pid > 0) return pid;
      }
    }
  } catch { /* tasklist is Windows-only */ }
  return null;
}

/**
 * POST /api/wechat-export/extract-key
 *
 * Streams Server-Sent Events (`event: progress` / `event: done` / `event: error`)
 * while extract_key.py runs. Typical run: 5-10 minutes scanning ~7 GB of
 * WeChat process memory.
 *
 * Pre-requirements verified upfront:
 *   - user already accepted the disclaimer
 *   - env is fully OK (sqlcipher / Xcode CLT / WeChat 4.x detected)
 *   - WeChat is currently signed adhoc (we resigned it)
 *   - WeChat process is live
 */
export async function POST(): Promise<Response> {
  const platform = getWeChatExportPlatform();
  if (!platform) {
    return NextResponse.json({ error: 'unsupported_platform' }, { status: 400 });
  }
  if (!hasValidConsent()) {
    return NextResponse.json({
      error: 'consent_required',
      message: '请先接受免责声明。',
    }, { status: 400 });
  }
  const env = runEnvProbes(platform);
  if (!env.allOk) {
    return NextResponse.json({
      error: 'env_not_ready',
      message: '环境检查未通过,请先解决:' + [
        env.wechat.ok ? null : env.wechat.detail,
        env.sqlcipher.ok ? null : env.sqlcipher.detail,
        env.xcodeCLT.ok ? null : env.xcodeCLT.detail,
        env.dataDir.ok ? null : env.dataDir.detail,
      ].filter(Boolean).join('; '),
    }, { status: 400 });
  }
  if (platform === 'darwin' && env.signed !== 'adhoc') {
    const message = env.signed === 'tencent'
      ? '微信仍是官方签名。请回到微信页面点击“开始修复”，让 Lumos 先临时放开微信读取保护。'
      : '无法确认微信签名状态。请回到微信页面点击“开始修复”，让 Lumos 重新检测并临时放开微信读取保护。';
    return NextResponse.json({
      error: 'wechat_not_resigned',
      message,
    }, { status: 400 });
  }
  const pid = platform === 'win32' ? findWindowsWeChatPid() : findWeChatPid();
  if (!pid) {
    return NextResponse.json({
      error: 'wechat_not_running',
      message: platform === 'win32'
        ? '未找到运行中的 Windows 微信进程。请先打开微信并完成登录。'
        : '未找到运行中的微信进程。请确认重签名后已重新打开微信。',
    }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send('start', { pid });
      const result = await extractKeys(pid, (p: KeyExtractionProgress) => {
        send('progress', p);
      });
      if (result.success) {
        send('done', {
          keysFound: result.keysFound,
          keysJsonPath: result.keysJsonPath,
          keyTxtPath: result.keyTxtPath,
        });
      } else {
        send('error', {
          message: result.error || '提取失败,请查看日志。',
          log: result.log.slice(-2000),
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
