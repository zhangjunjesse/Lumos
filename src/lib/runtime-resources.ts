import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_EXTERNAL_RESOURCE_DIRNAME = 'runtime-resources';

function addRoot(roots: string[], seen: Set<string>, root?: string | null): void {
  const trimmed = root?.trim();
  if (!trimmed) return;

  const resolved = path.resolve(trimmed);
  if (seen.has(resolved)) return;

  roots.push(resolved);
  seen.add(resolved);
}

export function getRuntimeDataDir(): string {
  return process.env.LUMOS_DATA_DIR
    || process.env.CLAUDE_GUI_DATA_DIR
    || path.join(os.homedir(), '.lumos');
}

export function getExternalRuntimeResourceRoot(): string {
  return process.env.LUMOS_EXTERNAL_RESOURCES_DIR
    || path.join(getRuntimeDataDir(), DEFAULT_EXTERNAL_RESOURCE_DIRNAME);
}

export function getRuntimeResourceRoots(): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();

  addRoot(roots, seen, process.env.LUMOS_EXTERNAL_RESOURCES_DIR);
  addRoot(roots, seen, path.join(getRuntimeDataDir(), DEFAULT_EXTERNAL_RESOURCE_DIRNAME));
  addRoot(roots, seen, process.resourcesPath);
  addRoot(roots, seen, process.resourcesPath ? path.join(process.resourcesPath, 'standalone') : null);
  addRoot(roots, seen, process.cwd() ? path.join(process.cwd(), 'resources') : null);
  addRoot(roots, seen, process.cwd());
  addRoot(roots, seen, process.env.INIT_CWD ? path.join(process.env.INIT_CWD, 'resources') : null);
  addRoot(roots, seen, process.env.INIT_CWD);

  if (process.execPath) {
    const execDir = path.dirname(process.execPath);
    addRoot(roots, seen, path.join(execDir, '..', 'Resources'));
    addRoot(roots, seen, path.join(execDir, '..', 'Resources', 'standalone'));
  }

  return roots;
}

export function buildRuntimeResourceCandidates(relativePath: string): string[] {
  return getRuntimeResourceRoots().map((root) => path.join(root, relativePath));
}

export function resolveRuntimeResourcePath(relativePath: string): string | null {
  for (const candidate of buildRuntimeResourceCandidates(relativePath)) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveRuntimeResourceRootFor(relativePath: string): string | null {
  for (const root of getRuntimeResourceRoots()) {
    if (fs.existsSync(path.join(root, relativePath))) {
      return root;
    }
  }

  return null;
}

export function resolveRuntimeResourceRoot(): string {
  return resolveRuntimeResourcePath('') || getExternalRuntimeResourceRoot();
}
