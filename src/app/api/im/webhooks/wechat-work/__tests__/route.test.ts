import crypto from 'node:crypto';

const TOKEN = 'TestToken';
const AES_KEY = 'A'.repeat(43);
const CORP_ID = 'wwTestCorp';

const fakeAdapter = {
  getCallbackCredentials: () => ({ token: TOKEN, aesKey: AES_KEY, corpId: CORP_ID }),
  injectInbound: jest.fn(),
};

let adapterAvailable = true;
jest.mock('@/lib/im', () => ({
  startAdapter: jest.fn(async () => {}),
  getActiveAdapter: jest.fn(() => (adapterAvailable ? fakeAdapter : null)),
}));

import { GET, POST } from '../route';

function encrypt(plaintext: string, opts: { random?: Buffer } = {}): string {
  const aesKey = Buffer.from(`${AES_KEY}=`, 'base64');
  const iv = aesKey.subarray(0, 16);
  const random = opts.random ?? crypto.randomBytes(16);
  const msgBuf = Buffer.from(plaintext, 'utf-8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msgBuf.length, 0);
  const corpBuf = Buffer.from(CORP_ID, 'utf-8');

  const body = Buffer.concat([random, lenBuf, msgBuf, corpBuf]);
  const padLen = 32 - (body.length % 32);
  const padded = Buffer.concat([body, Buffer.alloc(padLen, padLen)]);

  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

function sign(timestamp: string, nonce: string, encryptStr: string): string {
  const sorted = [TOKEN, timestamp, nonce, encryptStr].sort().join('');
  return crypto.createHash('sha1').update(sorted).digest('hex');
}

function buildGetRequest(qs: Record<string, string>): Parameters<typeof GET>[0] {
  const url = new URL('http://localhost/api/im/webhooks/wechat-work');
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v);
  return new Request(url.toString()) as unknown as Parameters<typeof GET>[0];
}

function buildPostRequest(qs: Record<string, string>, xml: string): Parameters<typeof POST>[0] {
  const url = new URL('http://localhost/api/im/webhooks/wechat-work');
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v);
  return new Request(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  fakeAdapter.injectInbound.mockReset();
  adapterAvailable = true;
});

describe('GET /api/im/webhooks/wechat-work — URL verification', () => {
  test('returns decrypted echostr on valid signature', async () => {
    const echostr = encrypt('hello-echo');
    const ts = '1700000000';
    const nonce = 'n1';
    const sig = sign(ts, nonce, echostr);

    const res = await GET(buildGetRequest({ msg_signature: sig, timestamp: ts, nonce, echostr }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello-echo');
  });

  test('400 on missing query', async () => {
    const res = await GET(buildGetRequest({ msg_signature: 'x' }));
    expect(res.status).toBe(400);
  });

  test('401 on invalid signature', async () => {
    const echostr = encrypt('whatever');
    const res = await GET(buildGetRequest({
      msg_signature: '0'.repeat(40),
      timestamp: '1700000000',
      nonce: 'n',
      echostr,
    }));
    expect(res.status).toBe(401);
  });

  test('503 when adapter not configured', async () => {
    adapterAvailable = false;
    const res = await GET(buildGetRequest({
      msg_signature: 'sig',
      timestamp: 't',
      nonce: 'n',
      echostr: 'e',
    }));
    expect(res.status).toBe(503);
  });
});

describe('POST /api/im/webhooks/wechat-work — message receive', () => {
  test('decrypts message and injects InboundMessage', async () => {
    const innerXml = [
      '<xml>',
      '<ToUserName><![CDATA[wwTestCorp]]></ToUserName>',
      '<FromUserName><![CDATA[user_a]]></FromUserName>',
      '<CreateTime>1700000010</CreateTime>',
      '<MsgType><![CDATA[text]]></MsgType>',
      '<Content><![CDATA[hello bot]]></Content>',
      '<MsgId>1234567890</MsgId>',
      '<AgentID>1000002</AgentID>',
      '</xml>',
    ].join('');
    const cipher = encrypt(innerXml);
    const ts = '1700000010';
    const nonce = 'n2';
    const sig = sign(ts, nonce, cipher);
    const body = `<xml><ToUserName><![CDATA[wwTestCorp]]></ToUserName><Encrypt><![CDATA[${cipher}]]></Encrypt></xml>`;

    const res = await POST(buildPostRequest({ msg_signature: sig, timestamp: ts, nonce }, body));
    expect(res.status).toBe(200);
    expect(fakeAdapter.injectInbound).toHaveBeenCalledTimes(1);
    const injected = fakeAdapter.injectInbound.mock.calls[0][0];
    expect(injected.text).toBe('hello bot');
    expect(injected.address.providerId).toBe('wechat-work');
    expect(injected.address.chatId).toBe('user_a');
    expect(injected.messageId).toBe('1234567890');
  });

  test('400 on missing query', async () => {
    const res = await POST(buildPostRequest({}, '<xml></xml>'));
    expect(res.status).toBe(400);
  });

  test('400 on missing Encrypt', async () => {
    const res = await POST(buildPostRequest({
      msg_signature: 'sig',
      timestamp: 't',
      nonce: 'n',
    }, '<xml><Other>x</Other></xml>'));
    expect(res.status).toBe(400);
  });

  test('401 on invalid signature', async () => {
    const cipher = encrypt('<xml/>');
    const body = `<xml><Encrypt><![CDATA[${cipher}]]></Encrypt></xml>`;
    const res = await POST(buildPostRequest({
      msg_signature: '0'.repeat(40),
      timestamp: '1700000000',
      nonce: 'n',
    }, body));
    expect(res.status).toBe(401);
  });

  test('skips non-text MsgType', async () => {
    const innerXml = '<xml><FromUserName><![CDATA[u]]></FromUserName><MsgType><![CDATA[image]]></MsgType></xml>';
    const cipher = encrypt(innerXml);
    const ts = '1700000020';
    const nonce = 'n3';
    const sig = sign(ts, nonce, cipher);
    const body = `<xml><Encrypt><![CDATA[${cipher}]]></Encrypt></xml>`;

    const res = await POST(buildPostRequest({ msg_signature: sig, timestamp: ts, nonce }, body));
    expect(res.status).toBe(200);
    expect(fakeAdapter.injectInbound).not.toHaveBeenCalled();
  });
});
