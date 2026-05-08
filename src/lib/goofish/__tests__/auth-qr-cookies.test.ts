import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __goofishAuthQrTestInternals as __goofishAuthTestInternals } from '../auth-qr';

describe('goofish QR cookie capture helpers', () => {
  test('keeps valued cookies and prefers taobao-scoped mtop cookies', () => {
    const selected = new Map();

    __goofishAuthTestInternals.mergeBridgeCookiesForGoofish(selected, [
      { name: '_m_h5_tk', value: 'goofish-token', domain: '.goofish.com', expirationDate: 100 },
      { name: 'unb', value: '2231807063', domain: '.goofish.com', expirationDate: 100 },
      { name: 'cookie2', value: 'goofish-cookie2', domain: '.goofish.com', expirationDate: 100 },
      { name: 'empty', value: '', domain: '.goofish.com' },
    ]);
    __goofishAuthTestInternals.mergeBridgeCookiesForGoofish(selected, [
      { name: '_m_h5_tk', value: 'taobao-token', domain: '.taobao.com', expirationDate: 50 },
      { name: 'cookie2', value: 'taobao-cookie2', domain: '.taobao.com', expirationDate: 50 },
    ]);

    expect(__goofishAuthTestInternals.bridgeCookieMapToRecord(selected)).toEqual({
      _m_h5_tk: 'taobao-token',
      unb: '2231807063',
      cookie2: 'taobao-cookie2',
    });
  });

  test('does not accept an already saved account during add-account QR login', () => {
    expect(__goofishAuthTestInternals.hasAcceptableQrCookies({
      _m_h5_tk: 'token',
      unb: '2231807063',
      cookie2: 'cookie',
    }, new Set(['2231807063']))).toBe(false);

    expect(__goofishAuthTestInternals.hasAcceptableQrCookies({
      _m_h5_tk: 'token',
      unb: '99887766',
      cookie2: 'cookie',
    }, new Set(['2231807063']))).toBe(true);
  });

  test('writes goofish-cli compatible cookies array', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-goofish-auth-'));
    const cookiesPath = path.join(tempDir, 'cookies.json');

    try {
      __goofishAuthTestInternals.writeGoofishCookiesJson(cookiesPath, {
        unb: '2231807063',
        _m_h5_tk: 'token',
        cookie2: 'cookie',
      });

      expect(JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'))).toEqual([
        { name: 'unb', value: '2231807063' },
        { name: '_m_h5_tk', value: 'token' },
        { name: 'cookie2', value: 'cookie' },
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
