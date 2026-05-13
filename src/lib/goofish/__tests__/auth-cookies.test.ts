import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  cookieDomainForName,
  cookieItemsToRecord,
  cookieRecordToItems,
  cookieValue,
  copyLoginResultCookiesToTarget,
  parseCookieHeader,
  readCookieRecord,
  readCookieItems,
  readUnbFromCookies,
  writeCookieItems,
  writeCookieRecord,
} from '../cookie-store';

describe('goofish auth cookie import helpers', () => {
  test('parses pasted Cookie header into goofish-cli compatible array', () => {
    const parsed = parseCookieHeader(
      'Cookie: unb=2231807063; _m_h5_tk=abc_def; cookie2=value=with=equals; empty=',
    );

    expect(parsed).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'unb', value: '2231807063' }),
      expect.objectContaining({ name: '_m_h5_tk', value: 'abc_def', domain: '.taobao.com' }),
      expect.objectContaining({ name: 'cookie2', value: 'value=with=equals' }),
    ]));
    expect(parsed.find((item) => item.name === 'empty')).toEqual(expect.objectContaining({ value: '' }));
  });

  test('extracts the Cookie line when a full request header block is pasted', () => {
    const parsed = parseCookieHeader([
      'GET / HTTP/1.1',
      'Host: www.goofish.com',
      'Cookie: unb=2231807063; _m_h5_tk=abc_def; cookie2=value',
      'User-Agent: Chrome',
    ].join('\n'));

    expect(cookieValue(parsed, 'unb')).toBe('2231807063');
    expect(cookieValue(parsed, '_m_h5_tk')).toBe('abc_def');
    expect(parsed.some((item) => item.name.startsWith('GET /'))).toBe(false);
  });

  test('normalizes cookie records and domain routing in one place', () => {
    expect(cookieDomainForName('_m_h5_tk')).toBe('.taobao.com');
    expect(cookieDomainForName('unb')).toBe('.goofish.com');

    const items = cookieRecordToItems({ unb: '2231807063', empty: '', _m_h5_tk: 'token' });
    expect(items).toEqual([
      { name: 'unb', value: '2231807063' },
      { name: '_m_h5_tk', value: 'token' },
    ]);
    expect(cookieItemsToRecord(items)).toEqual({ unb: '2231807063', _m_h5_tk: 'token' });
  });

  test('writes pasted cookies directly to target cookies file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-goofish-auth-'));
    const cookiesPath = path.join(tempDir, 'nested', 'cookies.json');

    try {
      writeCookieItems(cookiesPath, [
        { name: 'unb', value: '2231807063' },
        { name: '_m_h5_tk', value: 'token' },
      ]);

      expect(JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'))).toEqual([
        { name: 'unb', value: '2231807063' },
        { name: '_m_h5_tk', value: 'token' },
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('writes cookie records through the same chrome-export format', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-goofish-auth-'));
    const cookiesPath = path.join(tempDir, 'nested', 'cookies.json');

    try {
      writeCookieRecord(cookiesPath, {
        unb: '2231807063',
        _m_h5_tk: 'token',
      });

      expect(readCookieRecord(cookiesPath)).toEqual({
        unb: '2231807063',
        _m_h5_tk: 'token',
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('copies browser-login output path when upstream ignores target cookie path', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-goofish-auth-'));
    const sourcePath = path.join(tempDir, 'legacy', 'cookies.json');
    const targetPath = path.join(tempDir, 'account', 'cookies.json');

    try {
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(sourcePath, JSON.stringify([{ name: 'unb', value: '2231807063' }]));

      copyLoginResultCookiesToTarget({ path: sourcePath }, targetPath);

      expect(JSON.parse(fs.readFileSync(targetPath, 'utf-8'))).toEqual([
        { name: 'unb', value: '2231807063' },
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('reads both array and dict cookie formats', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-goofish-auth-'));
    const arrayPath = path.join(tempDir, 'array.json');
    const dictPath = path.join(tempDir, 'dict.json');

    try {
      fs.writeFileSync(arrayPath, JSON.stringify([{ name: 'unb', value: '2231807063' }]));
      fs.writeFileSync(dictPath, JSON.stringify({ unb: 2231807063, _m_h5_tk: 'token' }));

      expect(readUnbFromCookies(arrayPath)).toBe('2231807063');
      expect(readCookieItems(dictPath)).toEqual([
        { name: 'unb', value: '2231807063' },
        { name: '_m_h5_tk', value: 'token' },
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
