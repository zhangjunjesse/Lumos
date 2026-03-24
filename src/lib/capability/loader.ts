import { readdir, readFile } from 'fs/promises';
import path from 'path';
import os from 'os';

export interface LoadedCapability {
  id: string;
  type: 'code' | 'prompt';
  content: string;
  filePath: string;
}

export async function loadCapabilities(): Promise<LoadedCapability[]> {
  const dataDir = process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
  const capabilitiesDir = path.join(dataDir, 'capabilities');

  try {
    const files = await readdir(capabilitiesDir);
    const capabilities: LoadedCapability[] = [];

    for (const file of files) {
      const ext = path.extname(file);
      if (ext !== '.ts' && ext !== '.md') continue;

      const id = path.basename(file, ext);
      const filePath = path.join(capabilitiesDir, file);
      const content = await readFile(filePath, 'utf-8');

      capabilities.push({
        id,
        type: ext === '.ts' ? 'code' : 'prompt',
        content,
        filePath
      });
    }

    return capabilities;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
