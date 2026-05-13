// Mock the cloud-speech adapter so we can test transcribeAudioAttachment
// dispatching without hitting lumos-web. Adapter resolution returns the
// mocked CloudSpeechProvider; transcribeViaCloudProxy returns a synthetic
// TranscribeResult.
const resolveCloudSpeechProviderMock = jest.fn();
const transcribeViaCloudProxyMock = jest.fn();
jest.mock('../asr-adapters/cloud-speech', () => ({
  resolveCloudSpeechProvider: resolveCloudSpeechProviderMock,
  transcribeViaCloudProxy: transcribeViaCloudProxyMock,
}));

type ExecCallback = (error: Error | null, stdout?: string, stderr?: string) => void;
const mockExecFile = jest.fn((
  command: string,
  args: string[],
  _options: unknown,
  callback: ExecCallback,
) => {
  if (args.includes('-version')) {
    callback(null, 'ffmpeg version test', '');
    return;
  }
  if (command.includes('ffprobe')) {
    const probedFile = args[args.length - 1] || '';
    callback(null, probedFile.includes('meeting.m4a') ? '2400\n' : '1\n', '');
    return;
  }
  const outputPath = args[args.length - 1];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require('node:fs') as typeof import('node:fs');
  if (outputPath.includes('%03d')) {
    nodeFs.writeFileSync(outputPath.replace('%03d', '000'), Buffer.from('ID3compressed-audio-1'));
    nodeFs.writeFileSync(outputPath.replace('%03d', '001'), Buffer.from('ID3compressed-audio-2'));
  } else {
    nodeFs.writeFileSync(outputPath, Buffer.from('ID3compressed-audio'));
  }
  callback(null, '', '');
});
jest.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  cleanTextForSpeech,
  detectAudioFormat,
  transcribeAudioAttachment,
  SpeechProviderNotConfiguredError,
} from '../speech';

describe('im/core/speech', () => {
  beforeEach(() => {
    resolveCloudSpeechProviderMock.mockReset();
    transcribeViaCloudProxyMock.mockReset();
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
    expect(detectAudioFormat(Buffer.from('fLaCabc'))).toEqual({ mime: 'audio/flac', ext: 'flac' });
    expect(detectAudioFormat(Buffer.from([0xff, 0xf1, 0x50, 0x80]))).toEqual({ mime: 'audio/aac', ext: 'aac' });
  });

  test('transcribeAudioAttachment dispatches to cloud proxy when provider configured', async () => {
    resolveCloudSpeechProviderMock.mockResolvedValue({
      localProviderId: 'local-1',
      remoteProviderId: 'remote-uuid-42',
      providerType: 'volcengine-asr-v2',
      pricePerSecond: 0.0004,
    });
    transcribeViaCloudProxyMock.mockResolvedValue({
      text: '你好世界',
      empty: false,
      duration_seconds: 1.5,
      charged_amount: 0.0006,
      provider: 'volcengine-asr-v2',
    });

    const result = await transcribeAudioAttachment({
      id: 'voice-1',
      name: 'voice.wav',
      type: 'audio/wav',
      size: 8,
      data: Buffer.from('RIFFxxxx').toString('base64'),
    });

    expect(result.text).toBe('你好世界');
    expect(result.duration_seconds).toBe(1.5);
    expect(result.charged_amount).toBe(0.0006);
    expect(result.provider).toBe('volcengine-asr-v2');
    expect(transcribeViaCloudProxyMock).toHaveBeenCalledTimes(1);
  });

  test('transcribeAudioAttachment throws SpeechProviderNotConfiguredError when no provider', async () => {
    resolveCloudSpeechProviderMock.mockResolvedValue(null);

    await expect(
      transcribeAudioAttachment({
        id: 'voice-2',
        name: 'voice.amr',
        type: 'audio/amr',
        size: 16,
        data: Buffer.from('#!AMR\nfake audio').toString('base64'),
      }),
    ).rejects.toBeInstanceOf(SpeechProviderNotConfiguredError);
    expect(transcribeViaCloudProxyMock).not.toHaveBeenCalled();
  });

  test('transcribeAudioAttachment returns empty result for empty bytes (no throw)', async () => {
    const result = await transcribeAudioAttachment({
      id: 'voice-empty',
      name: 'voice.wav',
      type: 'audio/wav',
      size: 0,
      data: '',
    });
    expect(result.empty).toBe(true);
    expect(result.text).toBe('');
    expect(resolveCloudSpeechProviderMock).not.toHaveBeenCalled();
  });

  test('transcribeAudioAttachment can read bytes from filePath when data is empty', async () => {
    resolveCloudSpeechProviderMock.mockResolvedValue({
      localProviderId: 'local-1',
      remoteProviderId: 'remote-uuid-42',
      providerType: 'volcengine-asr-v2',
    });
    transcribeViaCloudProxyMock.mockResolvedValue({
      text: '文件路径转写',
      empty: false,
      provider: 'volcengine-asr-v2',
    });

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumos-speech-test-'));
    const filePath = path.join(tmpDir, 'voice.wav');
    await fs.writeFile(filePath, Buffer.from('RIFFxxxx'));

    try {
      const result = await transcribeAudioAttachment({
        id: 'voice-path',
        name: 'voice.wav',
        type: 'audio/wav',
        size: 8,
        data: '',
        filePath,
      });

      expect(result.text).toBe('文件路径转写');
      expect(transcribeViaCloudProxyMock).toHaveBeenCalledTimes(1);
      expect(transcribeViaCloudProxyMock.mock.calls[0][1]).toEqual(Buffer.from('RIFFxxxx'));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // 60s timeout: this test allocates a 21 MB buffer + writes/reads from disk;
  // the default 5 s isn't enough on slower CI / dev machines.
  test('transcribeAudioAttachment segments and compresses large audio before cloud upload', async () => {
    resolveCloudSpeechProviderMock.mockResolvedValue({
      localProviderId: 'local-1',
      remoteProviderId: 'remote-uuid-42',
      providerType: 'volcengine-asr-v2',
    });
    transcribeViaCloudProxyMock.mockResolvedValueOnce({
      text: '第一段',
      empty: false,
      duration_seconds: 300,
      charged_amount: 0.12,
      provider: 'volcengine-asr-v2',
    }).mockResolvedValueOnce({
      text: '第二段',
      empty: false,
      duration_seconds: 180,
      charged_amount: 0.08,
      provider: 'volcengine-asr-v2',
    });

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumos-speech-large-test-'));
    const filePath = path.join(tmpDir, 'meeting.m4a');
    const largeAudio = Buffer.concat([
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('ftyp'),
      Buffer.alloc(21 * 1024 * 1024),
    ]);
    await fs.writeFile(filePath, largeAudio);

    try {
      const result = await transcribeAudioAttachment({
        id: 'voice-large',
        name: 'meeting.m4a',
        type: 'audio/mp4',
        size: largeAudio.length,
        data: '',
        filePath,
      });

      expect(result.text).toBe('第一段\n\n第二段');
      expect(result.duration_seconds).toBe(480);
      expect(result.charged_amount).toBeCloseTo(0.2);
      expect(transcribeViaCloudProxyMock).toHaveBeenCalledTimes(2);
      const [preparedAttachment, preparedBytes] = transcribeViaCloudProxyMock.mock.calls[0].slice(0, 2);
      expect(mockExecFile).toHaveBeenCalled();
      expect(preparedAttachment.name).toBe('meeting-part-01.mp3');
      expect(preparedAttachment.type).toBe('audio/mpeg');
      expect(preparedAttachment.size).toBe(Buffer.from('ID3compressed-audio-1').length);
      expect(preparedBytes).toEqual(Buffer.from('ID3compressed-audio-1'));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);
});
