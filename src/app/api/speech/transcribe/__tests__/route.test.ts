import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

const TMP_DATA_DIR = path.join(os.tmpdir(), `lumos-speech-route-${process.pid}-${Date.now()}`);
let mockTranscribe: jest.Mock;

beforeAll(() => {
  fs.mkdirSync(TMP_DATA_DIR, { recursive: true });
  process.env.LUMOS_DATA_DIR = TMP_DATA_DIR;
});
afterAll(() => {
  delete process.env.LUMOS_DATA_DIR;
  fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true });
});

jest.mock('@/lib/im/core/speech', () => {
  class SpeechProviderNotConfiguredError extends Error {
    constructor(msg = 'no provider') { super(msg); }
  }
  mockTranscribe = jest.fn();
  return {
    transcribeAudioAttachment: (...args: unknown[]) => mockTranscribe(...args),
    SpeechProviderNotConfiguredError,
  };
});

// path-guard relies on os.homedir + LUMOS_DATA_DIR roots; we keep it real so
// the route's real safety check runs on the temp dir we set above.

let POST: typeof import('../route').POST;
beforeAll(async () => {
  ({ POST } = await import('../route'));
});

interface JsonRequestInit { body: unknown; }
function makeReq(init: JsonRequestInit): Parameters<typeof POST>[0] {
  return { json: async () => init.body } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/speech/transcribe', () => {
  beforeEach(() => mockTranscribe.mockReset());

  it('spools the transcript to ~/.lumos/transcripts/ and returns transcript_file + char_count instead of text', async () => {
    const audioPath = path.join(TMP_DATA_DIR, 'sample.m4a');
    await fsp.writeFile(audioPath, Buffer.from('not-real-audio'));

    const fullText = '嗯。然后从数据库里面去提出的'.repeat(2000);
    mockTranscribe.mockResolvedValueOnce({
      text: fullText,
      empty: false,
      duration_seconds: 3060,
      charged_amount: 0.18,
      provider: 'volcengine',
      request_id: 'req-123',
    });

    const res = await POST(makeReq({ body: { file_path: audioPath, name: 'sample.m4a' } }));
    expect(res.status).toBe(200);
    const json = await res.json();

    // The API keeps `text` inline for non-AI HTTP consumers (e.g. douyin
    // collector). The MCP server is what strips it before forwarding to the
    // model — see resources/mcp-servers/speech-to-text/speech_to_text_mcp.mjs.
    expect(json.ok).toBe(true);
    expect(json.text).toBe(fullText);
    expect(json.char_count).toBe(fullText.length);
    expect(json.transcript_file).toBeTruthy();
    expect(json.transcript_file.startsWith(path.join(TMP_DATA_DIR, 'transcripts') + path.sep)).toBe(true);

    // File on disk really has the full transcript.
    const written = await fsp.readFile(json.transcript_file, 'utf-8');
    expect(written).toBe(fullText);
  });

  it('skips spooling when the transcript is empty', async () => {
    const audioPath = path.join(TMP_DATA_DIR, 'silent.m4a');
    await fsp.writeFile(audioPath, Buffer.from('silence'));

    mockTranscribe.mockResolvedValueOnce({ text: '', empty: true, provider: 'volcengine' });

    const res = await POST(makeReq({ body: { file_path: audioPath } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.empty).toBe(true);
    expect(json.transcript_file).toBeNull();
    expect(json.char_count).toBe(0);
  });

  it('keeps CJK in the audio name safe but preserved in the file name (regression on character handling)', async () => {
    const audioPath = path.join(TMP_DATA_DIR, 'rec.m4a');
    await fsp.writeFile(audioPath, Buffer.from('x'));

    mockTranscribe.mockResolvedValueOnce({ text: '会议内容', empty: false, provider: 'p' });

    const res = await POST(makeReq({ body: { file_path: audioPath, name: '2026年05月25日 09点22分.m4a' } }));
    const json = await res.json();
    const base = path.basename(json.transcript_file);
    // {timestamp}-{stem}-{8-hex random}.txt — random suffix prevents
    // same-millisecond collisions.
    expect(base).toMatch(/^\d+-2026年05月25日_09点22分-[0-9a-f]{8}\.txt$/);
  });
});
