import { test } from 'node:test';
import assert from 'node:assert';
import { parseCommand } from '../../lib/feishu/command-parser';

test('parseCommand parses valid command', () => {
  const result = parseCommand('/help');
  assert.ok(result);
  assert.strictEqual(result.name, 'help');
  assert.strictEqual(result.args.length, 0);
});

test('parseCommand parses command with args', () => {
  const result = parseCommand('/bind session123');
  assert.ok(result);
  assert.strictEqual(result.name, 'bind');
  assert.deepStrictEqual(result.args, ['session123']);
});

test('parseCommand returns null for non-command', () => {
  const result = parseCommand('not a command');
  assert.strictEqual(result, null);
});
