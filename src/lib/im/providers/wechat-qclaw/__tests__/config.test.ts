import { parseQClawConfig, isQClawConfigValid } from '../config';

describe('wechat-qclaw/config: parseQClawConfig', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.QCLAW_HOST;
    delete process.env.QCLAW_BOT_ID;
    delete process.env.QCLAW_BOT_SECRET;
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  test('reads all fields from raw record', () => {
    const c = parseQClawConfig({
      qclaw_host: 'http://qclaw.local:9000',
      bot_id: 'bot1',
      bot_secret: 'sec',
      transport: 'longpoll',
      send_path: '/v2/send',
      events_path: '/v2/events',
      contacts_path: '/v2/contacts',
      health_path: '/v2/ping',
    });
    expect(c).toEqual({
      qclawHost: 'http://qclaw.local:9000',
      botId: 'bot1',
      botSecret: 'sec',
      transport: 'longpoll',
      sendPath: '/v2/send',
      eventsPath: '/v2/events',
      contactsPath: '/v2/contacts',
      healthPath: '/v2/ping',
    });
  });

  test('defaults sane values when raw empty', () => {
    const c = parseQClawConfig({});
    expect(c.qclawHost).toBe('http://localhost:8080');
    expect(c.transport).toBe('websocket');
    expect(c.sendPath).toBe('/api/messages/send');
    expect(c.eventsPath).toBe('/api/events');
  });

  test('strips trailing slash from host', () => {
    const c = parseQClawConfig({ qclaw_host: 'http://x:8080/' });
    expect(c.qclawHost).toBe('http://x:8080');
  });

  test('normalizes paths to start with /', () => {
    const c = parseQClawConfig({ send_path: 'send' });
    expect(c.sendPath).toBe('/send');
  });

  test('falls back to env vars', () => {
    process.env.QCLAW_BOT_ID = 'env_bot';
    process.env.QCLAW_BOT_SECRET = 'env_sec';
    const c = parseQClawConfig({});
    expect(c.botId).toBe('env_bot');
    expect(c.botSecret).toBe('env_sec');
  });

  test('normalizes transport', () => {
    expect(parseQClawConfig({ transport: 'longpoll' }).transport).toBe('longpoll');
    expect(parseQClawConfig({ transport: 'websocket' }).transport).toBe('websocket');
    expect(parseQClawConfig({ transport: 'bogus' }).transport).toBe('websocket');
  });
});

describe('wechat-qclaw/config: isQClawConfigValid', () => {
  const valid = {
    qclawHost: 'http://localhost:8080',
    botId: 'b',
    botSecret: 's',
    transport: 'websocket' as const,
    sendPath: '/x',
    eventsPath: '/x',
    contactsPath: '/x',
    healthPath: '/x',
  };
  test('all 3 required fields needed', () => {
    expect(isQClawConfigValid(valid)).toBe(true);
    expect(isQClawConfigValid({ ...valid, qclawHost: '' })).toBe(false);
    expect(isQClawConfigValid({ ...valid, botId: '' })).toBe(false);
    expect(isQClawConfigValid({ ...valid, botSecret: '' })).toBe(false);
  });
});
