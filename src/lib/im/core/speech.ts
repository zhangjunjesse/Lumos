import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IMFileAttachment } from './types';

const MAX_TTS_CHARS = 1800;
const MAX_ASR_BYTES = 25 * 1024 * 1024;
const DEFAULT_ASR_MODEL = 'whisper-1';
const ASR_NATIVE_AUDIO_EXTS = new Set(['wav', 'mp3', 'm4a', 'ogg']);

export interface SpeechAttachmentResult {
  ok: boolean;
  attachment?: IMFileAttachment;
  error?: string;
}

export function cleanTextForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, '代码块内容略。')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '图片。')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[`*_>#|~-]+/g, ' ')
    .replace(/https?:\/\/\S+/g, '链接。')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TTS_CHARS);
}

export async function synthesizeSpeechAttachment(text: string): Promise<SpeechAttachmentResult> {
  const speechText = cleanTextForSpeech(text);
  if (!speechText) return { ok: false, error: 'empty speech text' };

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumos-im-tts-'));
  try {
    const textPath = path.join(tmpDir, 'reply.txt');
    await fs.writeFile(textPath, speechText, 'utf8');

    let outputPath: string;
    if (process.platform === 'win32') {
      outputPath = await synthesizeWithWindowsSapi(tmpDir, textPath);
    } else if (process.platform === 'darwin') {
      outputPath = await synthesizeWithMacSay(tmpDir, textPath);
    } else {
      outputPath = await synthesizeWithEspeak(tmpDir, textPath);
    }

    const bytes = await fs.readFile(outputPath);
    if (bytes.length === 0) return { ok: false, error: 'empty speech output' };
    const ext = path.extname(outputPath).toLowerCase() || '.wav';
    const mime = ext === '.aiff' || ext === '.aif' ? 'audio/aiff' : 'audio/wav';
    const id = `im-tts-${randomUUID()}`;
    return {
      ok: true,
      attachment: {
        id,
        name: `${id}${ext}`,
        type: mime,
        size: bytes.length,
        data: bytes.toString('base64'),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface AudioFormat {
  mime: string;
  ext: string;
}

export interface OpenAICompatibleAsrTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
}

export function detectAudioFormat(bytes: Buffer): AudioFormat {
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF') {
    return { mime: 'audio/wav', ext: 'wav' };
  }
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3' || looksLikeMp3Frame(bytes)) {
    return { mime: 'audio/mpeg', ext: 'mp3' };
  }
  if (bytes.subarray(0, 4).toString('ascii') === 'OggS') {
    return { mime: 'audio/ogg', ext: 'ogg' };
  }
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    return { mime: 'audio/mp4', ext: 'm4a' };
  }
  if (bytes.subarray(0, 5).toString('ascii') === '#!AMR') {
    return { mime: 'audio/amr', ext: 'amr' };
  }
  return { mime: 'audio/silk', ext: 'silk' };
}

export async function transcribeAudioAttachment(attachment: IMFileAttachment): Promise<string> {
  const bytes = readAttachmentBytes(attachment);
  if (!bytes || bytes.length === 0 || bytes.length > MAX_ASR_BYTES) return '';
  const prepared = await prepareAudioForAsr(attachment, bytes);

  try {
    const explicitAsrTarget = resolveExplicitAsrProviderTarget();
    if (explicitAsrTarget) {
      const explicitTranscript = await transcribeWithOpenAICompatibleProvider(
        prepared.attachment,
        prepared.bytes,
        explicitAsrTarget,
      );
      if (explicitTranscript) return explicitTranscript;
    }

    const localTranscript = await transcribeWithLocalWhisper(prepared.attachment, prepared.bytes);
    if (localTranscript) return localTranscript;

    return '';
  } finally {
    await prepared.cleanup();
  }
}

export async function transcribeAudioAttachmentWithTarget(
  attachment: IMFileAttachment,
  target: OpenAICompatibleAsrTarget,
): Promise<string> {
  const bytes = readAttachmentBytes(attachment);
  if (!bytes || bytes.length === 0 || bytes.length > MAX_ASR_BYTES) return '';
  const prepared = await prepareAudioForAsr(attachment, bytes);
  try {
    return transcribeWithOpenAICompatibleProvider(prepared.attachment, prepared.bytes, target);
  } finally {
    await prepared.cleanup();
  }
}

interface PreparedAudio {
  attachment: IMFileAttachment;
  bytes: Buffer;
  cleanup: () => Promise<void>;
}

async function prepareAudioForAsr(attachment: IMFileAttachment, bytes: Buffer): Promise<PreparedAudio> {
  const format = detectAudioFormat(bytes);
  if (ASR_NATIVE_AUDIO_EXTS.has(format.ext)) {
    return { attachment, bytes, cleanup: async () => undefined };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumos-im-audio-'));
  const inputPath = path.join(tmpDir, `input.${format.ext}`);
  const outputPath = path.join(tmpDir, 'voice.wav');
  try {
    await fs.writeFile(inputPath, bytes);
    await execFileAsync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath, '-ac', '1', '-ar', '16000', outputPath],
      60_000,
    );
    const wavBytes = await fs.readFile(outputPath);
    if (wavBytes.length === 0) throw new Error('empty converted audio');
    const baseName = path.basename(attachment.name || 'voice').replace(/\.[^.]+$/, '') || 'voice';
    return {
      attachment: {
        ...attachment,
        name: `${baseName}.wav`,
        type: 'audio/wav',
        size: wavBytes.length,
        data: wavBytes.toString('base64'),
      },
      bytes: wavBytes,
      cleanup: async () => {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      },
    };
  } catch {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    return { attachment, bytes, cleanup: async () => undefined };
  }
}

async function transcribeWithLocalWhisper(attachment: IMFileAttachment, bytes: Buffer): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumos-im-asr-'));
  try {
    const ext = path.extname(attachment.name).toLowerCase() || `.${detectAudioFormat(bytes).ext}`;
    const audioPath = path.join(tmpDir, `voice${ext}`);
    await fs.writeFile(audioPath, bytes);
    const model = process.env.IM_VOICE_WHISPER_MODEL?.trim() || 'tiny';
    await execFileAsync(
      'whisper',
      [
        audioPath,
        '--model',
        model,
        '--task',
        'transcribe',
        '--output_format',
        'txt',
        '--output_dir',
        tmpDir,
        '--fp16',
        'False',
        '--verbose',
        'False',
      ],
      2 * 60 * 1000,
    );
    const files = await fs.readdir(tmpDir);
    const transcriptFile = files.find((file) => file.toLowerCase().endsWith('.txt'));
    if (!transcriptFile) return '';
    const transcript = await fs.readFile(path.join(tmpDir, transcriptFile), 'utf8');
    return transcript.replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function transcribeWithOpenAICompatibleProvider(
  attachment: IMFileAttachment,
  bytes: Buffer,
  explicitTarget: OpenAICompatibleAsrTarget,
): Promise<string> {
  const target = normalizeAsrTarget(explicitTarget);
  if (!target) return '';

  const form = new FormData();
  const fileName = attachment.name || `voice.${detectAudioFormat(bytes).ext}`;
  const fileBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.set('file', new Blob([fileBytes], { type: attachment.type || 'application/octet-stream' }), fileName);
  form.set('model', target.model);
  form.set('response_format', 'json');

  try {
    const res = await fetch(`${target.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${target.apiKey}`,
        ...target.headers,
      },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return '';
    const data = await res.json().catch(() => null) as { text?: unknown } | null;
    return typeof data?.text === 'string' ? data.text.replace(/\s+/g, ' ').trim() : '';
  } catch {
    return '';
  }
}

export function resolveExplicitAsrProviderTarget(): OpenAICompatibleAsrTarget | null {
  const envBaseUrl = process.env.IM_VOICE_ASR_BASE_URL?.trim();
  const envApiKey = process.env.IM_VOICE_ASR_API_KEY?.trim();
  const envModel = process.env.IM_VOICE_ASR_MODEL?.trim();
  if (!envBaseUrl || !envApiKey) return null;
  const baseUrl = normalizeOpenAIBaseUrl(envBaseUrl);
  if (!baseUrl) return null;
  return {
    baseUrl,
    apiKey: envApiKey,
    model: envModel || DEFAULT_ASR_MODEL,
  };
}

export function normalizeOpenAIBaseUrl(value: string): string {
  const trimmed = (value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.endsWith('/audio/transcriptions')) {
    return trimmed.slice(0, -'/audio/transcriptions'.length);
  }
  return trimmed;
}

function normalizeAsrTarget(target: OpenAICompatibleAsrTarget): OpenAICompatibleAsrTarget | null {
  const baseUrl = normalizeOpenAIBaseUrl(target.baseUrl);
  const apiKey = target.apiKey.trim();
  const model = target.model.trim() || DEFAULT_ASR_MODEL;
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl,
    apiKey,
    model,
    headers: target.headers,
  };
}

function readAttachmentBytes(attachment: IMFileAttachment): Buffer | null {
  if (attachment.data) {
    try {
      return Buffer.from(attachment.data, 'base64');
    } catch {
      return null;
    }
  }
  return null;
}

async function synthesizeWithWindowsSapi(tmpDir: string, textPath: string): Promise<string> {
  const scriptPath = path.join(tmpDir, 'speak.ps1');
  const outputPath = path.join(tmpDir, 'reply.wav');
  await fs.writeFile(
    scriptPath,
    [
      'param([string]$TextPath, [string]$OutputPath)',
      'Add-Type -AssemblyName System.Speech',
      '$text = Get-Content -LiteralPath $TextPath -Raw -Encoding UTF8',
      '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      'try {',
      '  try {',
      '    $culture = [System.Globalization.CultureInfo]::GetCultureInfo("zh-CN")',
      '    $voices = $synth.GetInstalledVoices($culture)',
      '    if ($voices.Count -gt 0) { $synth.SelectVoice($voices[0].VoiceInfo.Name) }',
      '  } catch {}',
      '  $synth.Rate = 0',
      '  $synth.Volume = 100',
      '  $synth.SetOutputToWaveFile($OutputPath)',
      '  $synth.Speak($text)',
      '} finally {',
      '  if ($synth) { $synth.Dispose() }',
      '}',
    ].join('\n'),
    'utf8',
  );
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, textPath, outputPath],
    90_000,
  );
  return outputPath;
}

async function synthesizeWithMacSay(tmpDir: string, textPath: string): Promise<string> {
  const aiffPath = path.join(tmpDir, 'reply.aiff');
  const wavPath = path.join(tmpDir, 'reply.wav');
  await execFileAsync('/usr/bin/say', ['-f', textPath, '-o', aiffPath], 90_000);
  try {
    await execFileAsync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16', aiffPath, wavPath], 30_000);
    return wavPath;
  } catch {
    return aiffPath;
  }
}

async function synthesizeWithEspeak(tmpDir: string, textPath: string): Promise<string> {
  const outputPath = path.join(tmpDir, 'reply.wav');
  await execFileAsync('espeak', ['-f', textPath, '-w', outputPath], 90_000);
  return outputPath;
}

function execFileAsync(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs }, (error, _stdout, stderr) => {
      if (error) {
        const detail = stderr?.trim();
        reject(new Error(detail ? `${error.message}: ${detail}` : error.message));
        return;
      }
      resolve();
    });
  });
}

function looksLikeMp3Frame(bytes: Buffer): boolean {
  if (bytes.length < 2) return false;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}
