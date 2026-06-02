import { app, crashReporter, dialog, type BrowserWindow, type WebContents } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Main-process crash observability.
 *
 * Historically the main process had zero crash handlers: an uncaught
 * exception, a renderer OOM, or a native (GPU/Chromium) crash made the whole
 * window vanish silently — no stack, no log, no dialog. This module is purely
 * additive: it records crashes to `<userData>/logs/crash.log` (plus native
 * minidumps under `<userData>/Crashpad`) and preserves existing behavior
 * (a fatal main-process error still terminates the app).
 */

function getCrashLogPath(): string {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'crash.log');
}

function appendCrashRecord(record: Record<string, unknown>): string | null {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      platform: `${process.platform} ${os.release()}`,
      appVersion: app.getVersion(),
      ...record,
    });
    const file = getCrashLogPath();
    fs.appendFileSync(file, line + '\n', 'utf-8');
    return file;
  } catch (err) {
    console.error('[crash-observer] failed to write crash log:', err);
    return null;
  }
}

function serializeError(value: unknown): Record<string, unknown> {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return { message: String(value) };
}

function safeUrl(contents: WebContents | null | undefined): string {
  try {
    return contents?.getURL() ?? '';
  } catch {
    return '';
  }
}

function showFatalDialog(kind: string, value: unknown, logFile: string | null): void {
  const detail = value instanceof Error ? value.message : String(value);
  const hint = logFile ? `\n\n崩溃详情已记录到：\n${logFile}` : '';
  try {
    dialog.showErrorBox('Lumos 异常退出', `主进程发生未捕获错误（${kind}）。\n\n${detail}${hint}`);
  } catch {
    /* dialog may be unavailable very early or during teardown */
  }
}

/**
 * Install global crash handlers. Call once, as early as possible (after the
 * userData path is configured so logs land in the right directory).
 */
export function installCrashObserver(): void {
  // Native minidumps for GPU / Chromium / native-addon crashes that JS
  // handlers cannot observe. Dumps are written locally, never uploaded.
  try {
    crashReporter.start({ submitURL: '', uploadToServer: false, compress: true });
  } catch (err) {
    console.warn('[crash-observer] crashReporter.start failed:', err);
  }

  process.on('uncaughtException', (err) => {
    console.error('[crash-observer] uncaughtException:', err);
    const file = appendCrashRecord({ kind: 'main:uncaughtException', error: serializeError(err) });
    showFatalDialog('uncaughtException', err, file);
    // The process state is undefined after an uncaught exception. Preserve the
    // pre-existing behavior (the app terminates) instead of limping on.
    app.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[crash-observer] unhandledRejection:', reason);
    // Non-fatal by Node default: record for diagnosis, do not terminate.
    appendCrashRecord({ kind: 'main:unhandledRejection', error: serializeError(reason) });
  });

  app.on('render-process-gone', (_event, contents, details) => {
    console.error('[crash-observer] render-process-gone:', details);
    appendCrashRecord({ kind: 'render-process-gone', url: safeUrl(contents), details });
  });

  app.on('child-process-gone', (_event, details) => {
    console.error('[crash-observer] child-process-gone:', details);
    appendCrashRecord({ kind: 'child-process-gone', details });
  });
}

/**
 * Attach per-window observers. Gives the window URL on hangs, which the
 * app-level `render-process-gone` does not always carry usefully.
 */
export function attachWindowCrashObserver(win: BrowserWindow): void {
  win.webContents.on('unresponsive', () => {
    console.warn('[crash-observer] window unresponsive');
    appendCrashRecord({ kind: 'window:unresponsive', url: safeUrl(win.webContents) });
  });
}
