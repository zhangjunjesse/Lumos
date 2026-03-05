import { test } from 'node:test';
import assert from 'node:assert';
import { validateInput } from '../../lib/bridge/security/validators';

test('validateInput accepts safe text', () => {
  const result = validateInput('normal text');
  assert.strictEqual(result.valid, true);
});

test('validateInput rejects null bytes', () => {
  const result = validateInput('text\x00here');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, 'null byte');
});

test('validateInput rejects path traversal', () => {
  const result = validateInput('../../../etc/passwd');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, 'path traversal');
});

test('validateInput rejects command substitution', () => {
  const result = validateInput('$(whoami)');
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, 'command substitution');
});

test('validateInput rejects long input', () => {
  const result = validateInput('a'.repeat(40000));
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, 'Input too long');
});
