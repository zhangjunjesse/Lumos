import { test } from 'node:test';
import assert from 'node:assert';

test('feishu-adapter module loads', () => {
  const adapter = require('../../lib/bridge/adapters/feishu-adapter');
  assert.ok(adapter);
});
