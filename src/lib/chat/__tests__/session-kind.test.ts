import {
  inferSessionKind,
  stripSessionMarkers,
  SESSION_MARKERS,
  SESSION_TITLES,
  LIBRARY_CHAT_LEGACY_FRAGMENT,
  type SessionKind,
} from '../session-kind';

describe('inferSessionKind — marker 优先（逐字复现迁移前判定）', () => {
  const cases: Array<[Exclude<SessionKind, 'chat'>, string]> = Object.entries(
    SESSION_MARKERS,
  ) as Array<[Exclude<SessionKind, 'chat'>, string]>;

  test.each(cases)('marker → kind=%s', (kind, marker) => {
    // 各 build*SystemPrompt 都是 [MARKER, ...正文].join('\n')
    const prompt = `${marker}\nYou are a dedicated assistant.\nLine 2.`;
    expect(inferSessionKind(prompt, 'any title')).toBe(kind);
  });

  test('marker 命中优先于标题（标题即便像别的类型也不改判定）', () => {
    const prompt = `${SESSION_MARKERS.workflow}\n...`;
    expect(inferSessionKind(prompt, SESSION_TITLES['wechat-assistant'])).toBe('workflow');
  });
});

describe('inferSessionKind — 标题兜底（老会话，marker 机制之前）', () => {
  test('微信标题兜底', () => {
    expect(inferSessionKind('some old prompt', SESSION_TITLES['wechat-assistant'])).toBe(
      'wechat-assistant',
    );
  });
  test('电商标题兜底', () => {
    expect(inferSessionKind('', SESSION_TITLES['ecommerce-assistant'])).toBe(
      'ecommerce-assistant',
    );
  });
  test('闲鱼标题兜底', () => {
    expect(inferSessionKind('', SESSION_TITLES['goofish-assistant'])).toBe('goofish-assistant');
  });
  test('library 需标题 AND 正文特征串同时命中', () => {
    expect(
      inferSessionKind(`... ${LIBRARY_CHAT_LEGACY_FRAGMENT} ...`, SESSION_TITLES.library),
    ).toBe('library');
  });
  test('library 仅标题命中、无正文特征串 → 不认（与旧逻辑一致）', () => {
    expect(inferSessionKind('unrelated prompt', SESSION_TITLES.library)).toBe('chat');
  });
  test('workflow / app-builder / creation / main-agent 历史上不靠标题，标题兜底不生效', () => {
    expect(inferSessionKind('', SESSION_TITLES.workflow)).toBe('chat');
    expect(inferSessionKind('', SESSION_TITLES['app-builder'])).toBe('chat');
    expect(inferSessionKind('', SESSION_TITLES.creation)).toBe('chat');
  });
});

describe('inferSessionKind — 普通对话与边界', () => {
  test('普通 chat', () => {
    expect(inferSessionKind('You are a helpful assistant.', 'New Chat')).toBe('chat');
  });
  test('空/undefined 输入退化为 chat', () => {
    expect(inferSessionKind('', '')).toBe('chat');
    expect(inferSessionKind(null, null)).toBe('chat');
    expect(inferSessionKind(undefined, undefined)).toBe('chat');
  });
});

describe('stripSessionMarkers', () => {
  test('剥掉独占行的 marker，保留正文', () => {
    const prompt = `${SESSION_MARKERS['main-agent']}\nYou are the main agent.\nBe helpful.`;
    expect(stripSessionMarkers(prompt)).toBe('You are the main agent.\nBe helpful.');
  });
  test('不误删含 marker 子串但非独占行的正文', () => {
    const line = `note: the token ${SESSION_MARKERS.workflow} appears inline here`;
    expect(stripSessionMarkers(line)).toBe(line);
  });
  test('幂等：剥过一次再剥不变（历史脏数据可反复运行）', () => {
    const prompt = `${SESSION_MARKERS.library}\nlibrary assistant`;
    const once = stripSessionMarkers(prompt);
    expect(stripSessionMarkers(once)).toBe(once);
  });
  test('无 marker 的普通 prompt 原样返回', () => {
    expect(stripSessionMarkers('plain prompt\nline2')).toBe('plain prompt\nline2');
  });
  test('空输入', () => {
    expect(stripSessionMarkers('')).toBe('');
    expect(stripSessionMarkers(null)).toBe('');
  });
});
