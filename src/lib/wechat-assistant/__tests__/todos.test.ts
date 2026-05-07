import Database from 'better-sqlite3';

import { migrateWeChatAssistantTables } from '@/lib/db/migrations-wechat-assistant';

let mockDb: Database.Database;

jest.mock('@/lib/db', () => ({
  getDb: () => mockDb,
}));

import {
  addManualTodo,
  insertTodoSuggestions,
  listTodos,
  updateTodoFollowup,
} from '../db';

describe('wechat assistant todos', () => {
  beforeEach(() => {
    mockDb = new Database(':memory:');
    migrateWeChatAssistantTables(mockDb);
  });

  afterEach(() => {
    mockDb.close();
  });

  it('persists all involved contacts for manual followups', () => {
    const todo = addManualTodo({
      text: '推进合同回款',
      involvedWxids: ['wxid_alice', 'wxid_bob', 'wxid_alice'],
      summary: '需要同时跟 Alice 和 Bob 确认',
    });

    expect(todo).toEqual(expect.objectContaining({
      sourceWxid: 'wxid_alice',
      involvedWxids: ['wxid_alice', 'wxid_bob'],
    }));

    const row = mockDb
      .prepare(`SELECT source_wxid, involved_wxids_json FROM wechat_assistant_todos WHERE id = ?`)
      .get(todo.id);
    expect(row).toEqual({
      source_wxid: 'wxid_alice',
      involved_wxids_json: '["wxid_alice","wxid_bob"]',
    });
  });

  it('updates involved contacts without losing other followup fields', () => {
    const todo = addManualTodo({
      text: '推进合同回款',
      involvedWxids: ['wxid_alice'],
      summary: '旧摘要',
      nextStep: '旧动作',
    });

    const updated = updateTodoFollowup(todo.id, {
      involvedWxids: ['wxid_bob', 'wxid_carol'],
    });

    expect(updated).toEqual(expect.objectContaining({
      text: '推进合同回款',
      summary: '旧摘要',
      nextStep: '旧动作',
      sourceWxid: 'wxid_bob',
      involvedWxids: ['wxid_bob', 'wxid_carol'],
    }));
  });

  it('keeps AI suggestions compatible with the legacy single source contact', () => {
    mockDb.prepare(`
      INSERT INTO wechat_assistant_runs
        (id, snapshot_hash, started_at, status, messages_scanned)
      VALUES ('run-1', 'hash', 1, 'running', 1)
    `).run();

    const [todo] = insertTodoSuggestions('run-1', [{
      text: '回复客户问题',
      source: 'other',
      sourceMsgId: 1,
      sourceText: '合同什么时候发',
      sourceDisplay: 'Alice',
      sourceWxid: 'wxid_alice',
      byWhenText: null,
      dueAt: null,
      confidence: 'high',
    }]);

    expect(todo).toEqual(expect.objectContaining({
      sourceWxid: 'wxid_alice',
      involvedWxids: ['wxid_alice'],
    }));
  });

  it('cleans internal identifiers before persisting AI suggestions', () => {
    mockDb.prepare(`
      INSERT INTO wechat_assistant_runs
        (id, snapshot_hash, started_at, status, messages_scanned)
      VALUES ('run-1', 'hash', 1, 'running', 1)
    `).run();

    const [todo] = insertTodoSuggestions('run-1', [{
      text: '25984985930267888@openim: 5.6语文作业',
      source: 'other',
      sourceMsgId: 1,
      sourceText: '25984985930267888@openim: 5.6语文作业 订正默写本',
      sourceDisplay: '25984985930267888@openim',
      sourceSenderDisplay: '45434442516',
      sourceWxid: '25984985930267888@openim',
      byWhenText: '45434442516 客户群',
      dueAt: null,
      confidence: 'high',
    }]);

    expect(todo).toEqual(expect.objectContaining({
      text: '5.6语文作业',
      sourceText: '5.6语文作业 订正默写本',
      sourceDisplay: '微信联系人',
      sourceSenderDisplay: '群成员',
      byWhenText: '客户群',
      summary: '5.6语文作业 订正默写本',
    }));

    const row = mockDb
      .prepare(`
        SELECT text, source_text, source_display, source_sender_display, by_when_text, summary
        FROM wechat_assistant_todos
        WHERE id = ?
      `)
      .get(todo.id);
    expect(JSON.stringify(row)).not.toMatch(/openim|45434442516|25984985930267888/);
  });

  it('cleans legacy AI todo rows when reading from the database', () => {
    mockDb.prepare(`
      INSERT INTO wechat_assistant_todos
        (id, text, source, source_text, source_display, source_sender_display, source_wxid,
         by_when_text, summary, next_step, confidence, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'todo-legacy',
      'wxid_bad: 回复 45434442516 客户群',
      'other',
      '25984985930267888@openim: 5.6语文作业',
      '25984985930267888@openim',
      '45434442516',
      '25984985930267888@openim',
      '45434442516 客户群',
      '来自「25984985930267888@openim」的微信消息',
      'wxid_bad: 继续跟进',
      'medium',
      'suggested',
      1,
    );

    const [todo] = listTodos({ status: 'suggested' });

    expect(todo).toEqual(expect.objectContaining({
      text: '回复 客户群',
      sourceText: '5.6语文作业',
      sourceDisplay: '微信联系人',
      sourceSenderDisplay: '群成员',
      byWhenText: '客户群',
      summary: '来自「微信联系人」的微信消息',
      nextStep: '继续跟进',
    }));
  });
});
