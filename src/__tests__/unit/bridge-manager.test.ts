import { test } from 'node:test';
import assert from 'node:assert';

test('bridge-manager module loads', () => {
  const manager = require('../../lib/bridge/bridge-manager');
  assert.ok(manager.getStatus);
  assert.ok(manager.start);
  assert.ok(manager.stop);
});

test('getStatus returns valid structure', () => {
  const { getStatus } = require('../../lib/bridge/bridge-manager');
  const status = getStatus();
  assert.ok(typeof status.running === 'boolean');
  assert.ok(Array.isArray(status.adapters));
});
