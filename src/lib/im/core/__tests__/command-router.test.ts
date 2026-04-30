import {
  parseSlashCommand,
  routeInboundCommand,
  maybeInterceptCommand,
} from '../command-router';
import { handleBuiltinCommand } from '../built-in-commands';
import type {
  IMAdapter,
  IMCommand,
  IMCommandContext,
  IMCommandHandler,
  IMCommandResult,
  InboundMessage,
  OutboundMessage,
  SendResult,
  ProbeResult,
} from '../types';

class FakeCommandAdapter implements IMAdapter, IMCommandHandler {
  readonly id = 'fake';
  sentMessages: OutboundMessage[] = [];
  customHandler: ((ctx: IMCommandContext) => Promise<IMCommandResult>) | null = null;

  async start() { /* noop */ }
  async stop() { /* noop */ }
  isRunning() { return true; }
  async consumeOne(): Promise<InboundMessage | null> { return null; }
  async send(message: OutboundMessage): Promise<SendResult> {
    this.sentMessages.push(message);
    return { ok: true, messageId: 'm1' };
  }
  async probe(): Promise<ProbeResult> { return { ok: true }; }
  validateConfig(): string | null { return null; }

  listCommands(): IMCommand[] { return [{ name: 'help', description: 'help' }]; }
  async handleCommand(ctx: IMCommandContext): Promise<IMCommandResult> {
    if (this.customHandler) return this.customHandler(ctx);
    return (await handleBuiltinCommand(ctx, 'Fake')) ?? { handled: false };
  }
}

class NoCommandAdapter implements IMAdapter {
  readonly id = 'no-cmd';
  async start() { /* noop */ }
  async stop() { /* noop */ }
  isRunning() { return true; }
  async consumeOne(): Promise<InboundMessage | null> { return null; }
  async send(): Promise<SendResult> { return { ok: true }; }
  async probe(): Promise<ProbeResult> { return { ok: true }; }
  validateConfig(): string | null { return null; }
}

function makeMessage(text: string): InboundMessage {
  return {
    messageId: 'mid',
    address: { providerId: 'fake', chatId: 'c1', userId: 'u1' },
    text,
    timestamp: Date.now(),
  };
}

describe('parseSlashCommand', () => {
  test('returns null for empty / non-slash input', () => {
    expect(parseSlashCommand('')).toBeNull();
    expect(parseSlashCommand('hello')).toBeNull();
    expect(parseSlashCommand('  no slash')).toBeNull();
  });

  test('parses bare command', () => {
    expect(parseSlashCommand('/help')).toEqual({ name: 'help', args: [], raw: '/help' });
  });

  test('parses command with args', () => {
    const p = parseSlashCommand('/bind alice bob');
    expect(p).not.toBeNull();
    expect(p!.name).toBe('bind');
    expect(p!.args).toEqual(['alice', 'bob']);
  });

  test('lower-cases command name', () => {
    expect(parseSlashCommand('/HELP')!.name).toBe('help');
  });

  test('handles leading whitespace', () => {
    expect(parseSlashCommand('   /ping')!.name).toBe('ping');
  });

  test('handles multi-line message body', () => {
    const p = parseSlashCommand('/echo line1\nline2');
    expect(p!.name).toBe('echo');
    // args splits on whitespace including newlines
    expect(p!.args).toEqual(['line1', 'line2']);
  });
});

describe('routeInboundCommand', () => {
  test('non-command falls through (intercepted=false)', async () => {
    const a = new FakeCommandAdapter();
    const r = await routeInboundCommand(a, makeMessage('regular chat'));
    expect(r.intercepted).toBe(false);
    expect(a.sentMessages).toHaveLength(0);
  });

  test('builtin /ping replies pong', async () => {
    const a = new FakeCommandAdapter();
    const r = await routeInboundCommand(a, makeMessage('/ping'));
    expect(r.intercepted).toBe(true);
    expect(a.sentMessages).toHaveLength(1);
    expect(a.sentMessages[0].text).toBe('pong');
  });

  test('builtin /help lists commands', async () => {
    const a = new FakeCommandAdapter();
    await routeInboundCommand(a, makeMessage('/help'));
    expect(a.sentMessages[0].text).toMatch(/Fake 命令/);
    expect(a.sentMessages[0].text).toMatch(/\/ping/);
  });

  test('builtin /whoami returns address', async () => {
    const a = new FakeCommandAdapter();
    await routeInboundCommand(a, makeMessage('/whoami'));
    expect(a.sentMessages[0].text).toMatch(/provider: fake/);
    expect(a.sentMessages[0].text).toMatch(/chatId:\s+c1/);
  });

  test('unhandled command returns intercepted=false', async () => {
    const a = new FakeCommandAdapter();
    const r = await routeInboundCommand(a, makeMessage('/unknown'));
    expect(r.intercepted).toBe(false);
    expect(a.sentMessages).toHaveLength(0);
  });

  test('handler exception sends ❌ ack', async () => {
    const a = new FakeCommandAdapter();
    a.customHandler = async () => {
      throw new Error('boom');
    };
    const r = await routeInboundCommand(a, makeMessage('/explode'));
    expect(r.intercepted).toBe(true);
    expect(a.sentMessages[0].text).toMatch(/失败：boom/);
  });

  test('send failure does not throw', async () => {
    const a = new FakeCommandAdapter();
    a.send = async () => { throw new Error('network down'); };
    await expect(routeInboundCommand(a, makeMessage('/ping'))).resolves.toEqual({
      intercepted: true,
      result: expect.any(Object),
    });
  });
});

describe('maybeInterceptCommand', () => {
  test('passes through when adapter has no IMCommandHandler', async () => {
    const a = new NoCommandAdapter();
    const msg = makeMessage('/ping');
    const result = await maybeInterceptCommand(a, msg);
    expect(result).toBe(msg);
  });

  test('returns null when intercepted', async () => {
    const a = new FakeCommandAdapter();
    const result = await maybeInterceptCommand(a, makeMessage('/ping'));
    expect(result).toBeNull();
    expect(a.sentMessages).toHaveLength(1);
  });

  test('returns message when adapter has commands but not slash', async () => {
    const a = new FakeCommandAdapter();
    const msg = makeMessage('hello');
    const result = await maybeInterceptCommand(a, msg);
    expect(result).toBe(msg);
  });
});
