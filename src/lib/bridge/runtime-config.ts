import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BRIDGE_RUNTIME_TOKEN_HEADER = 'x-lumos-bridge-runtime-token';
export const BRIDGE_RUNTIME_RELATIVE_PATH = path.join('runtime', 'bridge-runtime.json');

export type BridgeRuntimePlatform = 'feishu';
export type BridgeRuntimeTransportKind = 'websocket';
export type BridgeRuntimeTransportStatus =
  | 'starting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'stale';

export interface BridgeRuntimeConnectionSnapshot {
  platform: BridgeRuntimePlatform;
  transportKind: BridgeRuntimeTransportKind;
  status: BridgeRuntimeTransportStatus;
  accountId?: string;
  lastConnectedAt?: number | null;
  lastDisconnectedAt?: number | null;
  lastEventAt?: number | null;
  lastErrorAt?: number | null;
  lastErrorMessage?: string | null;
  pid?: number;
}

export interface BridgeRuntimeConfigFile {
  token: string;
  updatedAt: string;
  connections: Record<string, BridgeRuntimeConnectionSnapshot>;
}

function getConfiguredDataDir(): string {
  return process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
}

function getConnectionKey(snapshot: Pick<BridgeRuntimeConnectionSnapshot, 'platform' | 'transportKind' | 'accountId'>): string {
  return `${snapshot.platform}:${snapshot.accountId || 'default'}:${snapshot.transportKind}`;
}

export function getBridgeRuntimeFilePath(): string {
  return path.join(getConfiguredDataDir(), BRIDGE_RUNTIME_RELATIVE_PATH);
}

export function readBridgeRuntimeConfig(): BridgeRuntimeConfigFile | null {
  try {
    const filePath = getBridgeRuntimeFilePath();
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BridgeRuntimeConfigFile>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.token !== 'string' || !parsed.token.trim()) {
      return null;
    }

    return {
      token: parsed.token,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      connections: parsed.connections && typeof parsed.connections === 'object' ? parsed.connections : {},
    };
  } catch {
    return null;
  }
}

export function writeBridgeRuntimeConfig(config: BridgeRuntimeConfigFile): void {
  const filePath = getBridgeRuntimeFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

export function initializeBridgeRuntimeConfig(token: string): BridgeRuntimeConfigFile {
  const existing = readBridgeRuntimeConfig();
  const next: BridgeRuntimeConfigFile = {
    token,
    updatedAt: new Date().toISOString(),
    connections: existing?.connections || {},
  };
  writeBridgeRuntimeConfig(next);
  return next;
}

export function persistBridgeRuntimeSnapshot(
  snapshot: BridgeRuntimeConnectionSnapshot,
  token?: string,
): BridgeRuntimeConfigFile {
  const current = readBridgeRuntimeConfig();
  const next: BridgeRuntimeConfigFile = {
    token: token || current?.token || '',
    updatedAt: new Date().toISOString(),
    connections: {
      ...(current?.connections || {}),
      [getConnectionKey(snapshot)]: {
        ...snapshot,
        accountId: snapshot.accountId || 'default',
      },
    },
  };
  writeBridgeRuntimeConfig(next);
  return next;
}

export function clearBridgeRuntimeConfig(): void {
  try {
    const filePath = getBridgeRuntimeFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore cleanup failures during shutdown
  }
}

export function resolveBridgeRuntimeToken(): string | null {
  const fromEnv = process.env.LUMOS_BRIDGE_RUNTIME_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return readBridgeRuntimeConfig()?.token || null;
}
