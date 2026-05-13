import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IMFileAttachment } from './types';

const MAX_TTS_CHARS = 1800;
const LARGE_AUDIO_PREPROCESS_BYTES = 8 * 1024 * 1024;
const LONG_AUDIO_PREPROCESS_SECONDS = 10 * 60;
const ASR_SEGMENT_SECONDS = 5 * 60;
const ASR_FFMPEG_TIMEOUT_MS = 15 * 60 * 1000;
const ASR_BITRATES = ['24k', '16k', '12k'];

/** Thrown by transcribeAudioAttachment when no cloud speech provider is configured. */
export class SpeechProviderNotConfiguredError extends Error {
  readonly code = 'SPEECH_PROVIDER_NOT_CONFIGURED';
  constructor(message?: string) {
    super(message ?? '未配置语音服务商，请到设置 → 服务商 → 语音 配置火山引擎');
    this.name = 'SpeechProviderNotConfiguredError';
  }
}

// ============================================================================
// TTS (synthesize text → audio attachment) — unchanged from previous version.
// ============================================================================

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

// ============================================================================
// ASR (transcribe audio attachment → text) — cloud-only path.
// ============================================================================

export interface AudioFormat {
  mime: string;
  ext: string;
}

export function detectAudioFormat(bytes: Buffer): AudioFormat {
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF') return { mime: 'audio/wav', ext: 'wav' };
  if (bytes.subarray(0, 4).toString('ascii') === 'fLaC') return { mime: 'audio/flac', ext: 'flac' };
  if (looksLikeAacFrame(bytes)) return { mime: 'audio/aac', ext: 'aac' };
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3' || looksLikeMp3Frame(bytes)) {
    return { mime: 'audio/mpeg', ext: 'mp3' };
  }
  if (bytes.subarray(0, 4).toString('ascii') === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' };
  if (bytes.subarray(0, 5).toString('ascii') === '#!AMR') return { mime: 'audio/amr', ext: 'amr' };
  return { mime: 'audio/silk', ext: 'silk' };
}

export interface TranscribeResult {
  text: string;
  empty: boolean;
  duration_seconds?: number;
  charged_amount?: number;
  request_id?: string;
  provider: string;
}

/**
 * Transcribe audio via cloud speech provider (volcengine ASR by default).
 * Throws SpeechProviderNotConfiguredError when no cloud provider is set up
 * — callers should catch and present a settings link instead of swallowing.
 */
export async function transcribeAudioAttachment(
  attachment: IMFileAttachment,
): Promise<TranscribeResult> {
  const bytes = await readAttachmentBytes(attachment);
  if (!bytes || bytes.length === 0) {
    return { text: '', empty: true, provider: 'none' };
  }
  // Lazy import keeps TTS-only call sites cheap and avoids circular deps.
  const { resolveCloudSpeechProvider, transcribeViaCloudProxy } = await import(
    './asr-adapters/cloud-speech'
  );
  const provider = await resolveCloudSpeechProvider();
  if (!provider) {
    throw new SpeechProviderNotConfiguredError();
  }
  const prepared = await prepareAudioForCloud(attachment, bytes);
  try {
    if (prepared.inputs.length === 1) {
      const input = prepared.inputs[0];
      return transcribeViaCloudProxy(input.attachment, input.bytes, provider);
    }

    const results: TranscribeResult[] = [];
    for (let i = 0; i < prepared.inputs.length; i++) {
      const input = prepared.inputs[i];
      try {
        results.push(await transcribeViaCloudProxy(input.attachment, input.bytes, provider));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`第 ${i + 1}/${prepared.inputs.length} 段语音转写失败：${message}`);
      }
    }
    return combineTranscribeResults(results, provider.providerType);
  } finally {
    await prepared.cleanup?.();
  }
}

// ============================================================================
// Helpers
// ============================================================================

interface PreparedCloudAudioInput {
  attachment: IMFileAttachment;
  bytes: Buffer;
}

interface PreparedCloudAudioBatch {
  inputs: PreparedCloudAudioInput[];
  cleanup?: () => Promise<void>;
}

async function readAttachmentBytes(attachment: IMFileAttachment): Promise<Buffer | null> {
  if (attachment.data) {
    try {
      return Buffer.from(attachment.data, 'base64');
    } catch {
      return null;
    }
  }
  if (attachment.filePath) {
    try {
      return await fs.readFile(attachment.filePath);
    } catch {
      return null;
    }
  }
  return null;
}

async function prepareAudioForCloud(
  attachment: IMFileAttachment,
  bytes: Buffer,
): Promise<PreparedCloudAudioBatch> {
  const original: PreparedCloudAudioInput = {
    attachment: { ...attachment, size: bytes.length },
    bytes,
  };

  let tmpDir: string | null = null;
  let sourcePath = attachment.filePath || '';
  if (!sourcePath) {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumos-asr-input-'));
    sourcePath = path.join(tmpDir, `input.${inferAudioExtension(attachment, bytes)}`);
    await fs.writeFile(sourcePath, bytes);
  }

  const cleanup = async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  };

  const durationSeconds = await probeAudioDurationSeconds(sourcePath);
  const shouldPreprocess =
    bytes.length >= LARGE_AUDIO_PREPROCESS_BYTES
    || (typeof durationSeconds === 'number' && durationSeconds >= LONG_AUDIO_PREPROCESS_SECONDS);

  if (!shouldPreprocess) {
    return tmpDir ? { inputs: [original], cleanup } : { inputs: [original] };
  }

  const ffmpegPath = await findMediaBinary('ffmpeg');
  if (!ffmpegPath) {
    return tmpDir ? { inputs: [original], cleanup } : { inputs: [original] };
  }

  if (!tmpDir) {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumos-asr-preprocess-'));
  }

  for (const bitrate of ASR_BITRATES) {
    await removeGeneratedSegments(tmpDir);
    const pattern = path.join(tmpDir, 'segment-%03d.mp3');
    try {
      await execFileAsync(
        ffmpegPath,
        [
          '-y',
          '-i',
          sourcePath,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-b:a',
          bitrate,
          '-f',
          'segment',
          '-segment_time',
          String(ASR_SEGMENT_SECONDS),
          '-reset_timestamps',
          '1',
          pattern,
        ],
        ASR_FFMPEG_TIMEOUT_MS,
      );
      const segmentFiles = await listGeneratedSegments(tmpDir);
      if (segmentFiles.length === 0) continue;
      const inputs: PreparedCloudAudioInput[] = [];
      const baseName = path.basename(attachment.name || 'voice', path.extname(attachment.name || 'voice'));
      for (let i = 0; i < segmentFiles.length; i++) {
        const filePath = segmentFiles[i];
        const segmentBytes = await fs.readFile(filePath);
        if (segmentBytes.length === 0) {
          inputs.length = 0;
          break;
        }
        inputs.push({
          attachment: {
            id: `${attachment.id || 'voice'}-segment-${i + 1}`,
            name: `${baseName || 'voice'}-part-${String(i + 1).padStart(2, '0')}.mp3`,
            type: 'audio/mpeg',
            size: segmentBytes.length,
            data: '',
            filePath,
          },
          bytes: segmentBytes,
        });
      }
      if (inputs.length > 0) {
        return { inputs, cleanup };
      }
    } catch {
      // Try the next bitrate, then fall back to original bytes below.
    }
  }

  return { inputs: [original], cleanup };
}

function combineTranscribeResults(results: TranscribeResult[], fallbackProvider: string): TranscribeResult {
  const text = results.map((result) => result.text.trim()).filter(Boolean).join('\n\n');
  const duration = sumOptional(results.map((result) => result.duration_seconds));
  const charged = sumOptional(results.map((result) => result.charged_amount));
  const requestIds = results.map((result) => result.request_id).filter(Boolean).join(',');
  const provider = results.find((result) => result.provider)?.provider || fallbackProvider;
  return {
    text,
    empty: text.trim().length === 0,
    duration_seconds: duration,
    charged_amount: charged,
    request_id: requestIds || undefined,
    provider,
  };
}

function sumOptional(values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => typeof value === 'number');
  if (numbers.length === 0) return undefined;
  return numbers.reduce((sum, value) => sum + value, 0);
}

function inferAudioExtension(attachment: IMFileAttachment, bytes: Buffer): string {
  const nameExt = path.extname(attachment.name || '').replace(/^\./, '').toLowerCase();
  if (nameExt) return nameExt;
  const detected = detectAudioFormat(bytes);
  return detected.ext || 'bin';
}

async function probeAudioDurationSeconds(filePath: string): Promise<number | null> {
  const ffprobePath = await findMediaBinary('ffprobe');
  if (!ffprobePath) return null;
  try {
    const stdout = await execFileCaptureAsync(
      ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nokey=1:noprint_wrappers=1', filePath],
      10_000,
    );
    const parsed = Number.parseFloat(stdout.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function listGeneratedSegments(tmpDir: string): Promise<string[]> {
  const entries = await fs.readdir(tmpDir).catch(() => []);
  return entries
    .filter((entry) => /^segment-\d+\.mp3$/i.test(entry))
    .sort()
    .map((entry) => path.join(tmpDir, entry));
}

async function removeGeneratedSegments(tmpDir: string): Promise<void> {
  const segmentFiles = await listGeneratedSegments(tmpDir);
  await Promise.all(segmentFiles.map((file) => fs.unlink(file).catch(() => undefined)));
}

const mediaBinaryCache = new Map<string, string | null>();

async function findMediaBinary(binary: 'ffmpeg' | 'ffprobe'): Promise<string | null> {
  if (mediaBinaryCache.has(binary)) return mediaBinaryCache.get(binary) || null;
  const candidates = [
    binary,
    `/opt/homebrew/bin/${binary}`,
    `/usr/local/bin/${binary}`,
    `/usr/bin/${binary}`,
    `${process.env.HOME ?? ''}/anaconda3/bin/${binary}`,
    `${process.env.HOME ?? ''}/miniconda3/bin/${binary}`,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await execFileAsync(candidate, ['-version'], 3_000);
      mediaBinaryCache.set(binary, candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  mediaBinaryCache.set(binary, null);
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

function execFileCaptureAsync(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        const detail = typeof stderr === 'string' ? stderr.trim() : '';
        reject(new Error(detail ? `${error.message}: ${detail}` : error.message));
        return;
      }
      resolve(typeof stdout === 'string' ? stdout : String(stdout ?? ''));
    });
  });
}

function looksLikeMp3Frame(bytes: Buffer): boolean {
  if (bytes.length < 2) return false;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

function looksLikeAacFrame(bytes: Buffer): boolean {
  if (bytes.length < 2) return false;
  return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
}
