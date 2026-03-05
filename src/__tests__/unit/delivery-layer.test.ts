import { test } from 'node:test';
import assert from 'node:assert';

test('delivery-layer module loads', () => {
  const layer = require('../../lib/bridge/delivery-layer');
  assert.ok(layer);
});
