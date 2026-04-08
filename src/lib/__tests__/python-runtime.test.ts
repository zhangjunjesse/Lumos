import fs from 'fs';

const mockExecFileSync = jest.fn();
jest.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

import { resolvePythonBinary, getPythonVersion, isBundledPythonAvailable } from '../python-runtime';

beforeEach(() => {
  mockExecFileSync.mockReset();
});

describe('resolvePythonBinary', () => {
  it('returns bundled python if it exists and is executable', () => {
    const spy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    mockExecFileSync.mockReturnValue(Buffer.from('Python 3.12.8'));

    const result = resolvePythonBinary();
    expect(result).toBeTruthy();
    expect(result).toContain('python');
    spy.mockRestore();
  });

  it('returns null when no python available', () => {
    const spy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });

    expect(resolvePythonBinary()).toBeNull();
    spy.mockRestore();
  });
});

describe('getPythonVersion', () => {
  it('returns version string', () => {
    mockExecFileSync.mockReturnValue(Buffer.from('Python 3.12.8\n'));
    expect(getPythonVersion('/usr/bin/python3')).toBe('Python 3.12.8');
  });

  it('returns null on error', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('fail'); });
    expect(getPythonVersion('/nonexistent')).toBeNull();
  });
});

describe('isBundledPythonAvailable', () => {
  it('returns true when bundled binary exists', () => {
    const spy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    expect(isBundledPythonAvailable()).toBe(true);
    spy.mockRestore();
  });

  it('returns false when missing', () => {
    const spy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(isBundledPythonAvailable()).toBe(false);
    spy.mockRestore();
  });
});
