jest.mock('@/lib/db/providers', () => ({
  getDefaultProvider: jest.fn(() => undefined),
}));
jest.mock('@/lib/provider-model-discovery', () => ({
  parseProviderExtraEnv: jest.fn(() => ({})),
  resolveProviderRequestApiKey: jest.fn(() => ''),
}));
jest.mock('@/lib/model-metadata', () => ({
  resolveProviderModelForRequest: jest.fn(() => undefined),
}));

type ExecCallback = (error: Error | null, stdout?: string, stderr?: string) => void;

const mockExecFile = jest.fn((
  command: string,
  args: string[],
  _options: unknown,
  callback: ExecCallback,
) => {
  if (command === 'ffmpeg') {
    const outputPath = args[args.length - 1];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeFs = require('node:fs') as typeof import('node:fs');
    nodeFs.writeFileSync(outputPath, Buffer.from('RIFF converted wav bytes'));
    callback(null, '', '');
    return;
  }
  callback(new Error(`unexpected command: ${command}`), '', '');
});

jest.mock('node:child_process', () => ({
  execFile: (
    command: string,
    args: string[],
    options: unknown,
    callback: ExecCallback,
  ) => mockExecFile(command, args, options, callback),
}));

import { cleanTextForSpeech, detectAudioFormat, transcribeAudioAttachment } from '../speech';

describe('im/core/speech', () => {
  beforeEach(() => {
    mockExecFile.mockClear();
  });

  test('cleanTextForSpeech removes markdown noise and URLs', () => {
    const text = cleanTextForSpeech([
      '请看 [文档](https://example.com/doc)。',
      '![图](file:///tmp/a.png)',
      '```ts',
      'console.log("secret")',
      '```',
      '`重点` **加粗** https://example.com/x',
    ].join('\n'));

    expect(text).toContain('文档');
    expect(text).toContain('图片');
    expect(text).toContain('代码块内容略');
    expect(text).not.toContain('https://example.com');
    expect(text).not.toContain('```');
  });

  test('detectAudioFormat identifies common audio headers', () => {
    expect(detectAudioFormat(Buffer.from('RIFFxxxxWAVE'))).toEqual({ mime: 'audio/wav', ext: 'wav' });
    expect(detectAudioFormat(Buffer.from('ID3abc'))).toEqual({ mime: 'audio/mpeg', ext: 'mp3' });
    expect(detectAudioFormat(Buffer.from('OggSabc'))).toEqual({ mime: 'audio/ogg', ext: 'ogg' });
    expect(detectAudioFormat(Buffer.from('#!AMR\nabc'))).toEqual({ mime: 'audio/amr', ext: 'amr' });
  });

  test('transcribeAudioAttachment can fall back to OpenAI-compatible ASR from env', async () => {
    const originalEnv = {
      base: process.env.IM_VOICE_ASR_BASE_URL,
      key: process.env.IM_VOICE_ASR_API_KEY,
      model: process.env.IM_VOICE_ASR_MODEL,
    };
    const originalFetch = global.fetch;
    process.env.IM_VOICE_ASR_BASE_URL = 'https://asr.example/v1';
    process.env.IM_VOICE_ASR_API_KEY = 'asr-key';
    process.env.IM_VOICE_ASR_MODEL = 'whisper-test';
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ text: '  fallback transcript  ' }),
    }));
    (global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    try {
      const transcript = await transcribeAudioAttachment({
        id: 'voice-1',
        name: 'voice.wav',
        type: 'audio/wav',
        size: 8,
        data: Buffer.from('RIFFxxxx').toString('base64'),
      });

      expect(transcript).toBe('fallback transcript');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://asr.example/v1/audio/transcriptions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer asr-key' }),
        }),
      );
    } finally {
      global.fetch = originalFetch;
      if (originalEnv.base === undefined) delete process.env.IM_VOICE_ASR_BASE_URL;
      else process.env.IM_VOICE_ASR_BASE_URL = originalEnv.base;
      if (originalEnv.key === undefined) delete process.env.IM_VOICE_ASR_API_KEY;
      else process.env.IM_VOICE_ASR_API_KEY = originalEnv.key;
      if (originalEnv.model === undefined) delete process.env.IM_VOICE_ASR_MODEL;
      else process.env.IM_VOICE_ASR_MODEL = originalEnv.model;
    }
  });

  test('transcribeAudioAttachment transcodes AMR-like audio to wav before remote ASR when ffmpeg is available', async () => {
    const originalEnv = {
      base: process.env.IM_VOICE_ASR_BASE_URL,
      key: process.env.IM_VOICE_ASR_API_KEY,
      model: process.env.IM_VOICE_ASR_MODEL,
    };
    const originalFetch = global.fetch;
    process.env.IM_VOICE_ASR_BASE_URL = 'https://asr.example/v1';
    process.env.IM_VOICE_ASR_API_KEY = 'asr-key';
    process.env.IM_VOICE_ASR_MODEL = 'whisper-test';
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ text: ' converted transcript ' }),
    }));
    (global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    try {
      const transcript = await transcribeAudioAttachment({
        id: 'voice-amr',
        name: 'voice.amr',
        type: 'audio/amr',
        size: 16,
        data: Buffer.from('#!AMR\nfake audio').toString('base64'),
      });

      expect(transcript).toBe('converted transcript');
      expect(mockExecFile).toHaveBeenCalledWith(
        'ffmpeg',
        expect.arrayContaining(['-ac', '1', '-ar', '16000']),
        expect.objectContaining({ timeout: 60000 }),
        expect.any(Function),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://asr.example/v1/audio/transcriptions',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      global.fetch = originalFetch;
      if (originalEnv.base === undefined) delete process.env.IM_VOICE_ASR_BASE_URL;
      else process.env.IM_VOICE_ASR_BASE_URL = originalEnv.base;
      if (originalEnv.key === undefined) delete process.env.IM_VOICE_ASR_API_KEY;
      else process.env.IM_VOICE_ASR_API_KEY = originalEnv.key;
      if (originalEnv.model === undefined) delete process.env.IM_VOICE_ASR_MODEL;
      else process.env.IM_VOICE_ASR_MODEL = originalEnv.model;
    }
  });
});
