import crypto from 'crypto';

import {
  clearActiveCryptor,
  createSoftwareCryptor,
  getActiveCryptor,
  setActiveCryptor,
} from '../secret-cryptor';

describe('createSoftwareCryptor', () => {
  it('rejects keys that are not 32 bytes', () => {
    expect(() => createSoftwareCryptor(Buffer.alloc(16))).toThrow();
    expect(() => createSoftwareCryptor(Buffer.alloc(64))).toThrow();
    // @ts-expect-error wrong type intentionally
    expect(() => createSoftwareCryptor('not a buffer')).toThrow();
  });

  it('round-trips simple ASCII', () => {
    const c = createSoftwareCryptor(crypto.randomBytes(32));
    const cipher = c.encrypt('hello world');
    expect(cipher).not.toContain('hello');
    expect(c.decrypt(cipher)).toBe('hello world');
  });

  it('round-trips Unicode and long inputs', () => {
    const c = createSoftwareCryptor(crypto.randomBytes(32));
    const inputs = ['你好世界', '🔐💎', 'a'.repeat(10000), '', '\0\n\t'];
    for (const input of inputs) {
      expect(c.decrypt(c.encrypt(input))).toBe(input);
    }
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const c = createSoftwareCryptor(crypto.randomBytes(32));
    const a = c.encrypt('same');
    const b = c.encrypt('same');
    expect(a).not.toBe(b);
    expect(c.decrypt(a)).toBe('same');
    expect(c.decrypt(b)).toBe('same');
  });

  it('rejects ciphertext from another key', () => {
    const c1 = createSoftwareCryptor(crypto.randomBytes(32));
    const c2 = createSoftwareCryptor(crypto.randomBytes(32));
    const cipher = c1.encrypt('secret');
    expect(() => c2.decrypt(cipher)).toThrow();
  });

  it('rejects tampered ciphertext (auth tag check)', () => {
    const c = createSoftwareCryptor(crypto.randomBytes(32));
    const cipher = c.encrypt('secret');
    // Flip a bit in the body
    const buf = Buffer.from(cipher, 'base64');
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0x01;
    const tampered = buf.toString('base64');
    expect(() => c.decrypt(tampered)).toThrow();
  });

  it('rejects ciphertext with bad header', () => {
    const c = createSoftwareCryptor(crypto.randomBytes(32));
    expect(() => c.decrypt(Buffer.from('definitely not real ciphertext').toString('base64'))).toThrow();
  });

  it('rejects too-short ciphertext', () => {
    const c = createSoftwareCryptor(crypto.randomBytes(32));
    expect(() => c.decrypt(Buffer.from('short').toString('base64'))).toThrow();
  });

  it('reports availability', () => {
    const c = createSoftwareCryptor(crypto.randomBytes(32));
    expect(c.isAvailable()).toBe(true);
  });
});

describe('active cryptor singleton', () => {
  afterEach(() => clearActiveCryptor());

  it('throws when not initialized', () => {
    clearActiveCryptor();
    expect(() => getActiveCryptor()).toThrow(/not initialized/i);
  });

  it('returns the cryptor set via setActiveCryptor', () => {
    const c = createSoftwareCryptor(crypto.randomBytes(32));
    setActiveCryptor(c);
    expect(getActiveCryptor()).toBe(c);
  });

  it('clears cleanly', () => {
    setActiveCryptor(createSoftwareCryptor(crypto.randomBytes(32)));
    clearActiveCryptor();
    expect(() => getActiveCryptor()).toThrow();
  });
});
