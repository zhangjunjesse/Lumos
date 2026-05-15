import { normalizeCookieValue, parseCookieHeader } from '../auth';

describe('normalizeCookieValue', () => {
  it('strips wrapping double quotes from DevTools-pasted values', () => {
    expect(normalizeCookieValue('"abc123"')).toBe('abc123');
  });

  it('strips wrapping single quotes', () => {
    expect(normalizeCookieValue("'u=123'")).toBe('u=123');
  });

  it('drops a trailing separator left by whole-segment pastes', () => {
    expect(normalizeCookieValue('abc123;')).toBe('abc123');
    expect(normalizeCookieValue('abc123,')).toBe('abc123');
  });

  it('trims CRLF whitespace from cross-platform pastes', () => {
    expect(normalizeCookieValue('abc123\r')).toBe('abc123');
  });

  it('leaves a clean value untouched', () => {
    expect(normalizeCookieValue('abc123')).toBe('abc123');
  });

  it('does not strip a lone leading quote (not a matched pair)', () => {
    expect(normalizeCookieValue('"abc')).toBe('"abc');
  });
});

describe('parseCookieHeader', () => {
  it('parses a clean semicolon-joined paste', () => {
    const out = parseCookieHeader('auth_token=aaa; ct0=bbb; twid=u=123');
    expect(out).toEqual({ auth_token: 'aaa', ct0: 'bbb', twid: 'u=123' });
  });

  it('unquotes values from a DevTools-style cross-device paste', () => {
    const out = parseCookieHeader('auth_token="aaa"; ct0="bbb"; twid="u=123"');
    expect(out).toEqual({ auth_token: 'aaa', ct0: 'bbb', twid: 'u=123' });
  });

  it('handles CRLF newline-separated pastes', () => {
    const out = parseCookieHeader('auth_token=aaa\r\nct0=bbb\r\ntwid=u=123');
    expect(out).toEqual({ auth_token: 'aaa', ct0: 'bbb', twid: 'u=123' });
  });

  it('keeps the first = so twid=u=123 is not truncated', () => {
    expect(parseCookieHeader('twid=u=123').twid).toBe('u=123');
  });

  it('omits empty values so an emptied ct0 is treated as missing', () => {
    const out = parseCookieHeader('auth_token=aaa; ct0=""; twid=u=123');
    expect(out.ct0).toBeUndefined();
    expect('ct0' in out).toBe(false);
  });
});
