import path from 'node:path';
import { mimeFromPath, resolveLumosSandboxPath } from '../sandbox';

describe('resolveLumosSandboxPath', () => {
  test('rejects relative paths', () => {
    expect(resolveLumosSandboxPath('foo.png')).toBeNull();
    expect(resolveLumosSandboxPath('./x.docx')).toBeNull();
  });

  test('rejects empty input', () => {
    expect(resolveLumosSandboxPath('')).toBeNull();
  });

  test('rejects paths outside the allowed dirs', () => {
    expect(resolveLumosSandboxPath('/etc/passwd')).toBeNull();
    expect(resolveLumosSandboxPath('/Users/me/Documents/report.docx')).toBeNull();
  });

  test('accepts paths inside .lumos-uploads', () => {
    const p = '/Users/me/.lumos/.lumos-uploads/foo.docx';
    expect(resolveLumosSandboxPath(p)).toBe(p);
  });

  test('accepts paths inside .lumos-media', () => {
    const p = '/Users/me/.lumos/.lumos-media/img.png';
    expect(resolveLumosSandboxPath(p)).toBe(p);
  });

  test('accepts legacy .codepilot-* dirs for backwards compat', () => {
    const p = '/Users/me/.codepilot-uploads/x.pdf';
    expect(resolveLumosSandboxPath(p)).toBe(p);
  });

  test('ignores prefix-only matches like .lumos-mediax', () => {
    expect(resolveLumosSandboxPath('/tmp/.lumos-mediax/foo.png')).toBeNull();
  });

  test('accepts a Windows absolute path inside an allowed dir', () => {
    expect(
      resolveLumosSandboxPath('C:\\Users\\Admin\\.lumos\\.lumos-uploads\\report.docx', {
        pathImpl: path.win32,
        homeDir: 'C:\\Users\\Admin',
      }),
    ).toBe('C:\\Users\\Admin\\.lumos\\.lumos-uploads\\report.docx');
  });

  test('expands a leading ~ on Windows', () => {
    expect(
      resolveLumosSandboxPath('~\\.lumos\\.lumos-uploads\\report.docx', {
        pathImpl: path.win32,
        homeDir: 'C:\\Users\\Admin',
      }),
    ).toBe('C:\\Users\\Admin\\.lumos\\.lumos-uploads\\report.docx');
  });

  test('expands a leading ~ on POSIX', () => {
    expect(
      resolveLumosSandboxPath('~/.lumos/.lumos-uploads/report.docx', {
        pathImpl: path.posix,
        homeDir: '/Users/me',
      }),
    ).toBe('/Users/me/.lumos/.lumos-uploads/report.docx');
  });

  test('rejects a Windows absolute path outside allowed dirs', () => {
    expect(
      resolveLumosSandboxPath('C:\\Users\\Admin\\Documents\\secret.docx', {
        pathImpl: path.win32,
        homeDir: 'C:\\Users\\Admin',
      }),
    ).toBeNull();
  });
});

describe('mimeFromPath', () => {
  test.each([
    ['/x/foo.png', 'image/png'],
    ['/x/Foo.JPG', 'image/jpeg'],
    ['/x/report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['/x/data.csv', 'text/csv'],
    ['/x/report.pdf', 'application/pdf'],
    ['/x/archive.zip', 'application/zip'],
    ['/x/unknown.xyz', 'application/octet-stream'],
    ['/x/no-extension', 'application/octet-stream'],
  ])('%s → %s', (path, expected) => {
    expect(mimeFromPath(path)).toBe(expected);
  });
});
