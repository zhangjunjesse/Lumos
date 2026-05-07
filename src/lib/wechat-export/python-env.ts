import {
  ensureVenv,
  installPackage,
  listPackages,
} from '@/lib/python-venv';

const REQUIRED_API_PACKAGES_BY_PLATFORM = {
  darwin: ['zstandard>=0.23'],
  win32: ['pycryptodomex>=3.20'],
} as const;

const REQUIRED_MCP_PACKAGES_BY_PLATFORM = {
  darwin: ['zstandard>=0.23', 'mcp[cli]>=1.0.0'],
  win32: ['pycryptodomex>=3.20', 'mcp[cli]>=1.0.0'],
} as const;

const pendingEnsures = new Map<string, Promise<string>>();

export async function ensureWeChatExportPythonEnv(options: { includeMcp?: boolean } = {}): Promise<string> {
  const specs = getRequiredPackages(options.includeMcp === true);
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

function getRequiredPackages(includeMcp: boolean): string[] {
  const platform = process.platform === 'win32' ? 'win32' : 'darwin';
  return [
    ...(includeMcp
      ? REQUIRED_MCP_PACKAGES_BY_PLATFORM[platform]
      : REQUIRED_API_PACKAGES_BY_PLATFORM[platform]),
  ];
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
