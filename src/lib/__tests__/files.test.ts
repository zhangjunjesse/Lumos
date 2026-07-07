import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { scanDirectory } from '../files';
import type { FileTreeNode } from '@/types';

function findNode(nodes: FileTreeNode[], parts: string[]): FileTreeNode | null {
  const [head, ...tail] = parts;
  const node = nodes.find((item) => item.name === head);
  if (!node || tail.length === 0) return node ?? null;
  return node.children ? findNode(node.children, tail) : null;
}

describe('scanDirectory', () => {
  it('includes deep extracted files used by the project file tree', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumos-files-'));
    try {
      const targetDir = path.join(root, 'data', 'sample_downloads', 'repo', 'extracted', 'repo-main', 'skills', 'caveman');
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(path.join(targetDir, 'SKILL.md'), '# Caveman\n', 'utf8');

      const tree = await scanDirectory(root, 8);

      expect(findNode(tree, ['data', 'sample_downloads', 'repo', 'extracted', 'repo-main', 'skills', 'caveman', 'SKILL.md'])).toMatchObject({
        name: 'SKILL.md',
        type: 'file',
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
