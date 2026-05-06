import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { ensureVenv, getVenvDir } from '@/lib/python-venv';
import { qrReadyMarkerPath } from '@/lib/goofish/install-state';

const execFileAsync = promisify(execFile);
const IS_WINDOWS = process.platform === 'win32';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// pip + chromium install can run several minutes; lift the default 60s cap.
export const maxDuration = 600;

/**
 * Mirror defaults — most Lumos users are in mainland China, where PyPI and
 * playwright.azureedge.net are slow or unreachable. We default to known-good
 * China mirrors with the official sources as fallback so installs Just Work
 * out of the box. Power users / overseas users can override via env.
 *
 * Tsinghua's PyPI mirror tracks upstream within minutes for almost every
 * package; --extra-index-url adds PyPI as a safety net for rare misses.
 *
 * npmmirror's binaries CDN hosts Playwright's chromium tarballs at the same
 * paths Playwright expects, so PLAYWRIGHT_DOWNLOAD_HOST is a one-line swap.
 */
const PIP_INDEX_URL = process.env.LUMOS_PIP_INDEX_URL
  || 'https://pypi.tuna.tsinghua.edu.cn/simple';
const PIP_EXTRA_INDEX_URL = process.env.LUMOS_PIP_EXTRA_INDEX_URL
  || 'https://pypi.org/simple';
const PLAYWRIGHT_DOWNLOAD_HOST = process.env.LUMOS_PLAYWRIGHT_DOWNLOAD_HOST
  || 'https://cdn.npmmirror.com/binaries/playwright';
const PLAYWRIGHT_OFFICIAL_DOWNLOAD_HOST = 'https://playwright.download.prss.microsoft.com/dbazure/download/playwright';

// Pin playwright to the 1.x line — chromium tarball paths and CLI surface
// have shifted across major versions historically; staying on 1.x keeps the
// `python -m playwright install chromium` invocation stable.
const PLAYWRIGHT_SPEC = 'playwright>=1.40,<2.0';

function venvPip(): string {
  return path.join(
    getVenvDir(),
    IS_WINDOWS ? 'Scripts' : 'bin',
    IS_WINDOWS ? 'pip.exe' : 'pip',
  );
}

function pipInstallArgs(spec: string): string[] {
  return [
    'install',
    '--index-url', PIP_INDEX_URL,
    '--extra-index-url', PIP_EXTRA_INDEX_URL,
    spec,
  ];
}

type Scope = 'core' | 'qr';

/**
 * Per-scope in-flight registry. A second POST for the same scope while one
 * is already running awaits the existing promise instead of starting a new
 * `pip install` against the same venv — pip itself doesn't lock the venv,
 * so concurrent writes can corrupt site-packages.
 */
const inFlight = new Map<Scope, Promise<void>>();

function buildPlaywrightInstallEnvs(): Array<{ label: string; env: NodeJS.ProcessEnv }> {
  const out: Array<{ label: string; env: NodeJS.ProcessEnv }> = [];
  const add = (label: string, host?: string) => {
    if (host) {
      out.push({ label, env: { ...process.env, PLAYWRIGHT_DOWNLOAD_HOST: host } });
      return;
    }
    const env = { ...process.env };
    delete env.PLAYWRIGHT_DOWNLOAD_HOST;
    out.push({ label, env });
  };

  add(process.env.LUMOS_PLAYWRIGHT_DOWNLOAD_HOST ? '自定义下载源' : '国内镜像源', PLAYWRIGHT_DOWNLOAD_HOST);
  if (PLAYWRIGHT_DOWNLOAD_HOST !== PLAYWRIGHT_OFFICIAL_DOWNLOAD_HOST) {
    add('Playwright 官方源', PLAYWRIGHT_OFFICIAL_DOWNLOAD_HOST);
  }
  add('Playwright 默认源');
  return out;
}

function isLikelyMissingMirrorArtifact(message: string): boolean {
  return /NoSuchKey|server returned code 404|HTTP.*404|not found/i.test(message);
}

async function installPlaywrightChromium(venvPython: string): Promise<void> {
  const failures: string[] = [];
  for (const candidate of buildPlaywrightInstallEnvs()) {
    try {
      await execFileAsync(venvPython, ['-m', 'playwright', 'install', 'chromium'], {
        timeout: 480_000,
        env: candidate.env,
      });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${candidate.label}: ${message}`);
      if (isLikelyMissingMirrorArtifact(message)) {
        console.warn(`[goofish-install] ${candidate.label} missing Playwright Chromium artifact, retrying next source`);
      } else {
        console.warn(`[goofish-install] ${candidate.label} failed, retrying next source:`, message);
      }
    }
  }

  throw new Error(
    '备用扫码浏览器组件下载失败。已尝试国内镜像和 Playwright 官方源；如果网络需要代理，请配置代理后重试。'
    + `\n\n${failures.join('\n\n')}`,
  );
}

async function performInstall(scope: Scope): Promise<void> {
  const venvPython = await ensureVenv();
  const pip = venvPip();

  // Both scopes ensure goofish-cli is in the venv. qr is additive — QR login
  // also needs the goofish-cli Python modules at sidecar runtime, so we never
  // install playwright into a venv that's missing the core package. pip is
  // idempotent, so this is ~1s when already installed.
  await execFileAsync(pip, pipInstallArgs('goofish-cli'), { timeout: 240_000 });

  if (scope === 'core') return;

  // scope === 'qr'
  await execFileAsync(pip, pipInstallArgs(PLAYWRIGHT_SPEC), { timeout: 240_000 });
  await installPlaywrightChromium(venvPython);

  // Marker write must not fail the install — the binaries are already on disk
  // and re-running install is fine if the marker can't be written (worst case:
  // user re-prompted to download chromium next time, pip+playwright skip both).
  try {
    writeFileSync(qrReadyMarkerPath(), `${Date.now()}\n`);
  } catch (err) {
    console.warn('[goofish-install] failed to write qr-ready marker:', err);
  }
}

/**
 * POST /api/goofish/install
 *
 * Body:
 *   { scope: 'core' }  → ensure venv + pip install goofish-cli (~20MB)
 *   { scope: 'qr' }    → 'core' + pip install playwright + chromium (~150MB)
 *
 * Why two scopes: AI's actual data path (search / messages / history) goes
 * through Lumos's own browser bridge or mtop HTTP — see launcher.mjs header.
 * Playwright is only needed for the optional "扫码登录" window. Splitting
 * lets first-time users skip the 150MB chromium download until they pick QR.
 */
export async function POST(req: NextRequest) {
  let body: { scope?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const scope = body?.scope;
  if (scope !== 'core' && scope !== 'qr') {
    return NextResponse.json({ ok: false, error: 'invalid_scope' }, { status: 400 });
  }

  let task = inFlight.get(scope);
  if (!task) {
    task = performInstall(scope).finally(() => inFlight.delete(scope));
    inFlight.set(scope, task);
  }

  try {
    await task;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: 'install_failed', message },
      { status: 500 },
    );
  }
}
