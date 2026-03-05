import { test } from 'node:test';
import assert from 'node:assert';

test('db module loads', () => {
  const db = require('../../lib/db');
  assert.ok(db.getDb);
  assert.ok(db.initDb);
});
