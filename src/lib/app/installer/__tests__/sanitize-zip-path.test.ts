import { sanitizeZipPath } from '../install';

describe('sanitizeZipPath', () => {
  it('accepts a plain relative path', () => {
    expect(sanitizeZipPath('app.json')).toBe('app.json');
    expect(sanitizeZipPath('pages/main.json')).toBe('pages/main.json');
    expect(sanitizeZipPath('components/widget.tsx')).toBe('components/widget.tsx');
  });

  it('normalizes redundant separators', () => {
    expect(sanitizeZipPath('pages//main.json')).toBe('pages/main.json');
    expect(sanitizeZipPath('./pages/main.json')).toBe('pages/main.json');
  });

  it('rejects empty input', () => {
    expect(() => sanitizeZipPath('')).toThrow();
  });

  it('rejects Windows drive letters', () => {
    expect(() => sanitizeZipPath('C:\\Windows\\x')).toThrow(/drive letter/);
    expect(() => sanitizeZipPath('D:/file')).toThrow(/drive letter|backslash/);
  });

  it('rejects backslash separators', () => {
    expect(() => sanitizeZipPath('foo\\bar')).toThrow(/backslash/);
    expect(() => sanitizeZipPath('..\\..\\etc\\passwd')).toThrow(/backslash/);
  });

  it('rejects absolute POSIX paths', () => {
    expect(() => sanitizeZipPath('/etc/passwd')).toThrow(/absolute/);
    expect(() => sanitizeZipPath('//etc/passwd')).toThrow(/absolute/);
  });

  it('rejects parent traversal segments', () => {
    expect(() => sanitizeZipPath('../etc/passwd')).toThrow(/parent traversal/);
    expect(() => sanitizeZipPath('foo/../../bar')).toThrow(/parent traversal/);
    expect(() => sanitizeZipPath('a/b/../../../etc/x')).toThrow(/parent traversal/);
  });

  it('accepts paths that look traversal but normalize cleanly', () => {
    // 'foo/bar/../baz' resolves to 'foo/baz' — no escape.
    expect(sanitizeZipPath('foo/bar/../baz')).toBe('foo/baz');
  });
});
