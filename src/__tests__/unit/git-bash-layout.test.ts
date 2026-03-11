import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  getBundledGitBashPath,
  getGitBashValidationIssues,
  isGitBashPathUsable,
  resolveGitBashRoot,
} from '../../lib/windows-git-bash';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-git-bash-'));

function touch(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
}

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('windows-git-bash', () => {
  it('accepts a bundled Git Bash that keeps the bin layout intact', () => {
    const resourcesPath = path.join(tempRoot, 'valid-bin');
    const installRoot = path.join(resourcesPath, 'git-bash', 'win32', 'x64');
    const bashPath = path.join(installRoot, 'bin', 'bash.exe');

    touch(bashPath);
    touch(path.join(installRoot, 'usr', 'bin', 'cygpath.exe'));
    touch(path.join(installRoot, 'usr', 'bin', 'msys-2.0.dll'));

    assert.equal(resolveGitBashRoot(bashPath), installRoot);
    assert.equal(isGitBashPathUsable(bashPath), true);
    assert.equal(getBundledGitBashPath(resourcesPath, 'win32', 'x64'), bashPath);
  });

  it('accepts a PortableGit-style usr/bin/bash.exe path', () => {
    const installRoot = path.join(tempRoot, 'valid-usr', 'Git');
    const bashPath = path.join(installRoot, 'usr', 'bin', 'bash.exe');

    touch(bashPath);
    touch(path.join(installRoot, 'usr', 'bin', 'cygpath.exe'));
    touch(path.join(installRoot, 'usr', 'bin', 'msys-2.0.dll'));

    assert.equal(resolveGitBashRoot(bashPath), installRoot);
    assert.equal(isGitBashPathUsable(bashPath), true);
  });

  it('rejects the legacy flattened layout that only copied bash.exe to the root', () => {
    const resourcesPath = path.join(tempRoot, 'legacy-flat');
    const installRoot = path.join(resourcesPath, 'git-bash', 'win32', 'x64');
    const bashPath = path.join(installRoot, 'bash.exe');

    touch(bashPath);
    touch(path.join(installRoot, 'cygpath.exe'));
    touch(path.join(installRoot, 'msys-2.0.dll'));

    assert.equal(resolveGitBashRoot(bashPath), null);
    assert.equal(isGitBashPathUsable(bashPath), false);
    assert.deepEqual(getGitBashValidationIssues(bashPath), [
      'bash.exe must live under a Git Bash bin/ directory',
    ]);
    assert.equal(getBundledGitBashPath(resourcesPath, 'win32', 'x64'), null);
  });
});
