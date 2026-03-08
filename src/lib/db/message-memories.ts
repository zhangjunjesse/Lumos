import { getDb } from './connection';
import type { MemoryRecord } from './memories';

export interface MessageMemoryRelation {
  message_id: string;
  memory_id: string;
  relation_type: 'created' | 'used';
  created_at: string;
}

export function linkMessageMemory(
  messageId: string,
  memoryId: string,
  relationType: 'created' | 'used'
): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO message_memories (message_id, memory_id, relation_type)
     VALUES (?, ?, ?)`
  ).run(messageId, memoryId, relationType);
}

export function getMessageMemories(messageId: string): Array<MemoryRecord & { relation_type: string }> {
  const db = getDb();
  return db.prepare(
    `SELECT m.*, mm.relation_type
     FROM memories m
     JOIN message_memories mm ON m.id = mm.memory_id
     WHERE mm.message_id = ?
     ORDER BY mm.created_at DESC`
  ).all(messageId) as Array<MemoryRecord & { relation_type: string }>;
}
