import {
  ensureVenv,
  installPackage,
  listPackages,
} from '@/lib/python-venv';

const REQUIRED_API_PACKAGES = ['zstandard>=0.23'];
const REQUIRED_MCP_PACKAGES = ['zstandard>=0.23', 'mcp[cli]>=1.0.0'];

const pendingEnsures = new Map<string, Promise<string>>();

export async function ensureWeChatExportPythonEnv(options: { includeMcp?: boolean } = {}): Promise<string> {
  const specs = options.includeMcp ? REQUIRED_MCP_PACKAGES : REQUIRED_API_PACKAGES;
  const key = specs.join('|');
  let pendingEnsure = pendingEnsures.get(key);
  if (!pendingEnsure) {
    pendingEnsure = doEnsureWeChatExportPythonEnv(specs).catch((error) => {
      pendingEnsures.delete(key);
      throw error;
    });
    pendingEnsures.set(key, pendingEnsure);
  }
  return pendingEnsure;
}

async function doEnsureWeChatExportPythonEnv(requiredPackages: string[]): Promise<string> {
  const pythonPath = await ensureVenv();
  let installed: string[];
  try {
    installed = await listPackages();
  } catch {
    installed = [];
  }
  const installedNames = new Set(
    installed.map((spec) => spec.split('==')[0].toLowerCase().replace(/\[.*\]$/, '')),
  );

  for (const spec of requiredPackages) {
    const baseName = spec.split('[')[0].split('>=')[0].split('==')[0].toLowerCase();
    if (installedNames.has(baseName)) continue;
    await installPackage(spec);
    installedNames.add(baseName);
  }

  return pythonPath;
}
