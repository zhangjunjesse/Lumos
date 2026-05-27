import { sendOutbound } from '../send';
import { WechatClient } from '../client';

const fakeFetch = jest.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  fakeFetch.mockReset();
  (global as { fetch: typeof fetch }).fetch = fakeFetch as unknown as typeof fetch;
});
afterAll(() => {
  (global as { fetch: typeof fetch }).fetch = originalFetch;
});

const client = new WechatClient({ baseUrl: 'https://x', token: 'tk' });

const makeAddr = (chatId = 'alice@im.wechat') => ({
  providerId: 'wechat',
  chatId,
});

describe('wechat/send: sendOutbound', () => {
  test('rejects empty chatId', async () => {
    const r = await sendOutbound(client, { address: makeAddr(''), text: 'hi' }, {
      getContextToken: () => 'ctx',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/chatId/);
  });

  test('rejects when no context_token in store', async () => {
    const r = await sendOutbound(client, { address: makeAddr(), text: 'hi' }, {
      getContextToken: () => '',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/context_token/);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  test('rejects empty text', async () => {
    const r = await sendOutbound(client, { address: makeAddr(), text: '   ' }, {
      getContextToken: () => 'ctx',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/);
  });

  test('sends text with context_token', async () => {
    fakeFetch.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ ret: 0 }) });
    const r = await sendOutbound(client, { address: makeAddr(), text: 'hello' }, {
      getContextToken: () => 'ctx-1',
    });
    expect(r.ok).toBe(true);
    expect(r.messageId).toBeTruthy();
    const [, init] = fakeFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.msg.context_token).toBe('ctx-1');
    expect(body.msg.item_list[0].text_item.text).toBe('hello');
  });

  test('surfaces ilink session timeout as a rebind instruction', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ errcode: -14, errmsg: 'session timeout' }),
    });
    const r = await sendOutbound(client, { address: makeAddr(), text: 'hello' }, {
      getContextToken: () => 'ctx-1',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/重新扫码绑定/);
    expect(r.error).toMatch(/errcode=-14/);
  });

  test('uses inbound provider hint context_token before persisted store', async () => {
    fakeFetch.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ ret: 0 }) });
    const r = await sendOutbound(
      client,
      {
        address: makeAddr(),
        text: 'hello',
        providerHints: { wechat: { contextToken: 'ctx-from-inbound' } },
      },
      { getContextToken: () => 'ctx-from-store' },
    );

    expect(r.ok).toBe(true);
    const [, init] = fakeFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.msg.context_token).toBe('ctx-from-inbound');
  });

  test('uses inbound provider hint even when persisted store is empty', async () => {
    fakeFetch.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ ret: 0 }) });
    const r = await sendOutbound(
      client,
      {
        address: makeAddr(),
        text: 'hello',
        providerHints: { wechat: { contextToken: 'ctx-from-inbound' } },
      },
      { getContextToken: () => '' },
    );

    expect(r.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  test('splits long text into protocol-sized chunks', async () => {
    fakeFetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ ret: 0 }) });
    const long = 'x'.repeat(8000); // > MAX_CHUNK 1900 → 5 chunks
    const r = await sendOutbound(client, { address: makeAddr(), text: long }, {
      getContextToken: () => 'ctx',
    });
    expect(r.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(5);
  });

  test('retries once on ret=-2', async () => {
    fakeFetch
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ ret: -2, errmsg: 'expired' }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ ret: 0 }) });
    const r = await sendOutbound(client, { address: makeAddr(), text: 'hi' }, {
      getContextToken: () => 'ctx',
    });
    expect(r.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  test('retries stale inbound context_token with latest persisted token', async () => {
    fakeFetch
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ ret: -2, errmsg: 'expired' }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ ret: 0 }) });

    const r = await sendOutbound(
      client,
      {
        address: makeAddr(),
        text: 'hi',
        providerHints: { wechat: { contextToken: 'ctx-old' } },
      },
      { getContextToken: () => 'ctx-new' },
    );

    expect(r.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fakeFetch.mock.calls[0][1].body);
    const secondBody = JSON.parse(fakeFetch.mock.calls[1][1].body);
    expect(firstBody.msg.context_token).toBe('ctx-old');
    expect(secondBody.msg.context_token).toBe('ctx-new');
  });

  test('file attachment: getuploadurl → CDN upload → sendmessage with file_item', async () => {
    const fakeDocBytes = Buffer.from('PK\x03\x04 fake docx zip header');

    fakeFetch.mockReset();
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ret: 0, upload_full_url: 'https://cdn.example/c2c/upload?file=1' }),
    });
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k === 'x-encrypted-param' ? 'FILE-DL-PARAM' : null) },
    });
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ret: 0 }),
    });

    const r = await sendOutbound(
      client,
      {
        address: makeAddr(),
        text: '',
        attachments: [{
          id: 'doc-1',
          name: '报告.docx',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: fakeDocBytes.length,
          data: fakeDocBytes.toString('base64'),
        }],
      },
      { getContextToken: () => 'ctx' },
    );

    expect(r.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(3);

    // getuploadurl payload should advertise media_type=3 (UPLOAD_MEDIA_FILE)
    const uploadCall = fakeFetch.mock.calls[0];
    expect(uploadCall[0]).toMatch(/getuploadurl$/);
    const uploadBody = JSON.parse(uploadCall[1].body) as { media_type: number };
    expect(uploadBody.media_type).toBe(3);

    // sendmessage payload contains file_item with file_name + len
    const sendCall = fakeFetch.mock.calls[2];
    expect(sendCall[0]).toMatch(/sendmessage$/);
    const body = JSON.parse(sendCall[1].body) as {
      msg: { item_list: Array<{ type: number; file_item: { file_name: string; len: string; media: { encrypt_query_param: string } } }> };
    };
    const item = body.msg.item_list[0];
    expect(item.type).toBe(4); // MESSAGE_ITEM_FILE
    expect(item.file_item.file_name).toBe('报告.docx');
    expect(item.file_item.len).toBe(String(fakeDocBytes.length));
    expect(item.file_item.media.encrypt_query_param).toBe('FILE-DL-PARAM');
  });

  test('audio attachment with native hint: getuploadurl → CDN upload → sendmessage with voice_item', async () => {
    const wavBytes = makeTinyWav();

    fakeFetch.mockReset();
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ret: 0, upload_full_url: 'https://cdn.example/c2c/upload?voice=1' }),
    });
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k === 'x-encrypted-param' ? 'VOICE-DL-PARAM' : null) },
    });
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ret: 0 }),
    });

    const r = await sendOutbound(
      client,
      {
        address: makeAddr(),
        text: '',
        attachments: [{
          id: 'voice-1',
          name: 'reply.wav',
          type: 'audio/wav',
          size: wavBytes.length,
          data: wavBytes.toString('base64'),
          providerHints: { wechat: { nativeVoice: true } },
        }],
      },
      { getContextToken: () => 'ctx' },
    );

    expect(r.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(3);

    const uploadCall = fakeFetch.mock.calls[0];
    expect(uploadCall[0]).toMatch(/getuploadurl$/);
    const uploadBody = JSON.parse(uploadCall[1].body) as { media_type: number };
    expect(uploadBody.media_type).toBe(4);

    const sendCall = fakeFetch.mock.calls[2];
    expect(sendCall[0]).toMatch(/sendmessage$/);
    const body = JSON.parse(sendCall[1].body) as {
      msg: {
        item_list: Array<{
          type: number;
          voice_item: {
            encode_type: number;
            sample_rate: number;
            bits_per_sample: number;
            playtime: number;
            media: { encrypt_query_param: string };
          };
        }>;
      };
    };
    const item = body.msg.item_list[0];
    expect(item.type).toBe(3); // MESSAGE_ITEM_VOICE
    expect(item.voice_item.encode_type).toBe(3); // VOICE_FORMAT_WAVE
    expect(item.voice_item.sample_rate).toBe(16000);
    expect(item.voice_item.bits_per_sample).toBe(16);
    expect(item.voice_item.playtime).toBe(100);
    expect(item.voice_item.media.encrypt_query_param).toBe('VOICE-DL-PARAM');
  });

  test('audio native send error falls back to file_item', async () => {
    const wavBytes = makeTinyWav();

    fakeFetch.mockReset();
    fakeFetch
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ ret: 0, upload_full_url: 'https://cdn.example/c2c/upload?voice=1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: (k: string) => (k === 'x-encrypted-param' ? 'VOICE-DL-PARAM' : null) },
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ ret: 40001, errmsg: 'voice not allowed' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ ret: 0, upload_full_url: 'https://cdn.example/c2c/upload?file=1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: (k: string) => (k === 'x-encrypted-param' ? 'FILE-DL-PARAM' : null) },
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ ret: 0 }),
      });

    const r = await sendOutbound(
      client,
      {
        address: makeAddr(),
        text: '',
        attachments: [{
          id: 'voice-1',
          name: 'reply.wav',
          type: 'audio/wav',
          size: wavBytes.length,
          data: wavBytes.toString('base64'),
          providerHints: { wechat: { nativeVoice: true } },
        }],
      },
      { getContextToken: () => 'ctx' },
    );

    expect(r.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(6);
    const fallbackSendCall = fakeFetch.mock.calls[5];
    const body = JSON.parse(fallbackSendCall[1].body) as {
      msg: { item_list: Array<{ type: number; file_item: { file_name: string } }> };
    };
    const item = body.msg.item_list[0];
    expect(item.type).toBe(4);
    expect(item.file_item.file_name).toBe('reply.wav');
  });

  test('image attachment: getuploadurl → CDN upload → sendmessage', async () => {
    const onePngPixel = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);

    fakeFetch.mockReset();
    // 1) getUploadURL
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ret: 0, upload_full_url: 'https://cdn.example/c2c/upload?xx=1' }),
    });
    // 2) CDN upload (POST) returns x-encrypted-param header
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k === 'x-encrypted-param' ? 'DOWNLOAD-PARAM-123' : null) },
    });
    // 3) sendMessage
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ret: 0 }),
    });

    const r = await sendOutbound(
      client,
      {
        address: makeAddr(),
        text: '',
        attachments: [{
          id: 'img-1',
          name: 'pic.png',
          type: 'image/png',
          size: onePngPixel.length,
          data: onePngPixel.toString('base64'),
        }],
      },
      { getContextToken: () => 'ctx' },
    );

    expect(r.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(3);

    // verify sendmessage payload contains image_item with download_param + base64(hex(aes))
    const sendCall = fakeFetch.mock.calls[2];
    expect(sendCall[0]).toMatch(/sendmessage$/);
    const body = JSON.parse(sendCall[1].body) as {
      msg: { item_list: Array<{ type: number; image_item: { media: { encrypt_query_param: string; aes_key: string; encrypt_type: number } } }> };
    };
    const item = body.msg.item_list[0];
    expect(item.type).toBe(2); // MESSAGE_ITEM_IMAGE
    expect(item.image_item.media.encrypt_query_param).toBe('DOWNLOAD-PARAM-123');
    expect(item.image_item.media.encrypt_type).toBe(1);
    // aes_key is base64(hex(rawKey)) — 16 bytes → 32 hex chars → 44-char base64 (with =)
    expect(item.image_item.media.aes_key).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(item.image_item.media.aes_key.length).toBeGreaterThanOrEqual(40);
  });
});

function makeTinyWav(): Buffer {
  const sampleRate = 16_000;
  const channels = 1;
  const bitsPerSample = 16;
  const samples = 1600; // 100 ms
  const dataSize = samples * channels * (bitsPerSample / 8);
  const bytes = Buffer.alloc(44 + dataSize);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36 + dataSize, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  bytes.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  bytes.writeUInt16LE(bitsPerSample, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(dataSize, 40);
  return bytes;
}
