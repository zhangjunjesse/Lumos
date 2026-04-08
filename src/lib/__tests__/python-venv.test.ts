import fs from 'fs';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
  execFileSync: jest.fn(),
}));

jest.mock('../python-runtime', () => ({
  resolvePythonBinary: jest.fn(() => '/mock/python3'),
}));

jest.mock('../db/connection', () => ({
  dataDir: '/tmp/lumos-test',
}));

import { getVenvPythonPath, isVenvReady, getVenvDir } from '../python-venv';

describe('python-venv', () => {
  describe('getVenvDir', () => {
    it('returns path under dataDir', () => {
      expect(getVenvDir()).toBe('/tmp/lumos-test/python-venv');
    });
  });

  describe('getVenvPythonPath', () => {
    it('returns path with python-venv dir', () => {
      const p = getVenvPythonPath();
      expect(p).toContain('python-venv');
      expect(p).toContain('python');
    });
  });

  describe('isVenvReady', () => {
    it('returns false when venv python does not exist', () => {
      const spy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      expect(isVenvReady()).toBe(false);
      spy.mockRestore();
    });

    it('returns true when venv python exists', () => {
      const spy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      expect(isVenvReady()).toBe(true);
      spy.mockRestore();
    });
  });
});
