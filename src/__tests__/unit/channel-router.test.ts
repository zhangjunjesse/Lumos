import { test } from 'node:test';
import assert from 'node:assert';

test('channel-router module loads', () => {
  const router = require('../../lib/bridge/channel-router');
  assert.ok(router);
});
