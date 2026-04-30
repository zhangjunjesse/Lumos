import fs from 'fs';
import os from 'os';
import path from 'path';

import { resolveAssetPath } from '../asset-resolver';

describe('resolveAssetPath', () => {
  let installRoot: string;

  beforeAll(() => {
    installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-resolver-test-'));
    // Set up a representative installed app layout.
    fs.writeFileSync(path.join(installRoot, 'app.json'), '{}');
    fs.writeFileSync(path.join(installRoot, 'routes.json'), '{}');
    fs.writeFileSync(path.join(installRoot, 'icon.png'), 'PNG_PLACEHOLDER');
    fs.mkdirSync(path.join(installRoot, 'pages'));
    fs.writeFileSync(path.join(installRoot, 'pages', 'main.json'), '{}');
    fs.writeFileSync(path.join(installRoot, 'pages', 'customers.json'), '{}');
    fs.mkdirSync(path.join(installRoot, 'workflows'));
    fs.writeFileSync(path.join(installRoot, 'workflows', 'gen.json'), '{}');
    fs.mkdirSync(path.join(installRoot, 'assets'));
    fs.writeFileSync(path.join(installRoot, 'assets', 'logo.svg'), '<svg/>');
    fs.mkdirSync(path.join(installRoot, 'pages', 'nested'));
    fs.writeFileSync(path.join(installRoot, 'pages', 'nested', 'deep.json'), '{}');

    // Forbidden zones we'd like to confirm we never serve from.
    fs.mkdirSync(path.join(installRoot, 'components'));
    fs.writeFileSync(path.join(installRoot, 'components', 'Whiteboard.tsx'), 'code');
    fs.mkdirSync(path.join(installRoot, '.history'));
    fs.writeFileSync(path.join(installRoot, '.history', 'snap.json'), '{}');
    fs.writeFileSync(path.join(installRoot, '.env'), 'SECRET=1');
  });

  afterAll(() => {
    fs.rmSync(installRoot, { recursive: true, force: true });
  });

  describe('happy path', () => {
    it('serves whitelisted top-level files', () => {
      for (const f of ['app.json', 'routes.json', 'icon.png']) {
        const r = resolveAssetPath(installRoot, [f]);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.absolutePath).toBe(path.join(installRoot, f));
      }
    });

    it('serves files under whitelisted directories', () => {
      const r = resolveAssetPath(installRoot, ['pages', 'main.json']);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.absolutePath).toBe(path.join(installRoot, 'pages', 'main.json'));
    });

    it('serves nested paths under whitelisted directories', () => {
      const r = resolveAssetPath(installRoot, ['pages', 'nested', 'deep.json']);
      expect(r.ok).toBe(true);
    });
  });

  describe('rejections', () => {
    it('rejects empty segment list', () => {
      const r = resolveAssetPath(installRoot, []);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('EmptyPath');
    });

    it.each([
      ['..'],
      ['.'],
      [''],
      ['.hidden'],
      ['.env'],
      ['has/slash'],
      ['has\\backslash'],
      ['contains*glob'],
      ['<lt'],
    ])('rejects bad segment %s', (seg) => {
      const r = resolveAssetPath(installRoot, [seg]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('BadSegment');
    });

    it('rejects unknown top-level file', () => {
      const r = resolveAssetPath(installRoot, ['LICENSE.txt']);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('TopFileNotAllowed');
    });

    it('rejects unknown top-level directory', () => {
      const r = resolveAssetPath(installRoot, ['private', 'thing.json']);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('TopDirNotAllowed');
    });

    it('rejects components/ (reserved for code apps in M6+)', () => {
      const r = resolveAssetPath(installRoot, ['components', 'Whiteboard.tsx']);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('TopDirRejected');
    });

    it('rejects .history dotdir even though dot prefix already fails earlier', () => {
      const r = resolveAssetPath(installRoot, ['.history', 'snap.json']);
      expect(r.ok).toBe(false);
      // Caught by the per-segment regex before TopDir check.
      if (!r.ok) expect(['BadSegment', 'TopDirRejected']).toContain(r.reason);
    });

    it('rejects parent traversal attempts even with valid prefix', () => {
      // Even though the per-segment check rejects '..' first, we want to be
      // double-sure the resolved path can never escape installRoot.
      const r = resolveAssetPath(installRoot, ['pages', '..']);
      expect(r.ok).toBe(false);
    });

    it('rejects directories', () => {
      const r = resolveAssetPath(installRoot, ['pages']);
      // 'pages' is not in ALLOWED_TOP_LEVEL_FILES so this fails earlier:
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('TopFileNotAllowed');
    });

    it('rejects missing files', () => {
      const r = resolveAssetPath(installRoot, ['pages', 'nope.json']);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('NotFound');
    });
  });

  describe('symlink defense', () => {
    it('rejects a symlink even if the link target is inside the install root', () => {
      const link = path.join(installRoot, 'pages', 'link.json');
      try {
        fs.symlinkSync(path.join(installRoot, 'pages', 'main.json'), link);
      } catch {
        return; // platforms without symlink support
      }
      try {
        const r = resolveAssetPath(installRoot, ['pages', 'link.json']);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('IsSymlink');
      } finally {
        fs.unlinkSync(link);
      }
    });

    it('rejects a symlink that points outside the install root', () => {
      const target = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
      try {
        const evil = path.join(target, 'secrets.json');
        fs.writeFileSync(evil, '{}');
        const link = path.join(installRoot, 'assets', 'evil.json');
        try {
          fs.symlinkSync(evil, link);
        } catch {
          return; // platforms without symlink support
        }
        try {
          const r = resolveAssetPath(installRoot, ['assets', 'evil.json']);
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.reason).toBe('IsSymlink');
        } finally {
          fs.unlinkSync(link);
        }
      } finally {
        fs.rmSync(target, { recursive: true, force: true });
      }
    });
  });

  describe('size limit', () => {
    it('rejects files larger than maxBytes', () => {
      const big = path.join(installRoot, 'assets', 'big.svg');
      fs.writeFileSync(big, 'X'.repeat(2048));
      try {
        const r = resolveAssetPath(installRoot, ['assets', 'big.svg'], { maxBytes: 1024 });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe('TooLarge');
      } finally {
        fs.unlinkSync(big);
      }
    });

    it('accepts files at exactly maxBytes', () => {
      const file = path.join(installRoot, 'assets', 'exact.svg');
      fs.writeFileSync(file, 'X'.repeat(100));
      try {
        const r = resolveAssetPath(installRoot, ['assets', 'exact.svg'], { maxBytes: 100 });
        expect(r.ok).toBe(true);
      } finally {
        fs.unlinkSync(file);
      }
    });
  });
});
