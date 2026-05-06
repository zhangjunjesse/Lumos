/**
 * Persisted markers for the goofish install flow.
 *
 * `qrReady` answers a single question: did the user already pay the
 * playwright + chromium download cost? If yes, the GoofishPanel can route
 * straight into the QR login window instead of re-prompting "需要下载 ~150MB".
 *
 * We use a filesystem marker rather than re-probing because the actual
 * chromium binary lives in a platform-specific path (~/Library/Caches/
 * ms-playwright on macOS, ~/.cache/ms-playwright on Linux, %LOCALAPPDATA%
 * on Windows) and re-implementing that resolver here is more brittle than
 * trusting our own install API to write the marker on success.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { getVenvDir } from '../python-venv';

export function qrReadyMarkerPath(): string {
  return path.join(getVenvDir(), '.goofish-qr-ready');
}

export function isQrReady(): boolean {
  return existsSync(qrReadyMarkerPath());
}
