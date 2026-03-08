/**
 * Document parsers — unified text extraction for Word/Excel/PDF/TXT/MD
 * Returns structured ParsedDocument with title, content, metadata
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import type { ParsedDocument, DocumentMetadata } from './types';

const MIME_MAP: Record<string, string> = {
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.docm': 'application/vnd.ms-word.document.macroEnabled.12',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pptm': 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.md': 'text/markdown',
  '.mdx': 'text/markdown',
  '.json': 'application/json',
  '.jsonl': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.ini': 'text/plain',
  '.conf': 'text/plain',
  '.toml': 'text/plain',
  '.sql': 'text/plain',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.epub': 'application/epub+zip',
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.bz2': 'application/x-bzip2',
  '.xz': 'application/x-xz',
};

const FULL_PARSE_EXTS = new Set([
  '.docx',
  '.xlsx',
  '.xls',
  '.xlsm',
  '.ods',
  '.csv',
  '.tsv',
  '.pdf',
  '.md',
  '.mdx',
  '.txt',
  '.text',
  '.log',
  '.ini',
  '.cfg',
  '.conf',
  '.toml',
  '.properties',
  '.sql',
  '.json',
  '.jsonl',
  '.html',
  '.htm',
  '.xml',
  '.yaml',
  '.yml',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.rb',
  '.php',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.hh',
  '.cs',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  '.lua',
  '.r',
  '.scala',
  '.vue',
  '.svelte',
  '.astro',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.proto',
  '.gradle',
  '.dockerfile',
  '.env',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.ipynb',
  '.rtf',
]);

const REFERENCE_ONLY_EXTS = new Set([
  '.doc',
  '.docm',
  '.ppt',
  '.pptx',
  '.pptm',
  '.odt',
  '.odp',
  '.wps',
  '.et',
  '.dps',
  '.ofd',
  '.pages',
  '.numbers',
  '.key',
  '.epub',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.svg',
  '.heic',
  '.heif',
  '.avif',
  '.mp3',
  '.wav',
  '.aac',
  '.flac',
  '.m4a',
  '.ogg',
  '.opus',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.m4v',
  '.zip',
  '.7z',
  '.rar',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
]);

const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.svg',
  '.heic',
  '.heif',
  '.avif',
]);

const AUDIO_EXTS = new Set([
  '.mp3',
  '.wav',
  '.aac',
  '.flac',
  '.m4a',
  '.ogg',
  '.opus',
]);

const VIDEO_EXTS = new Set([
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.m4v',
]);

const LIKELY_BINARY_EXTS = new Set([
  '.exe',
  '.dll',
  '.dylib',
  '.so',
  '.bin',
  '.o',
  '.a',
  '.class',
  '.node',
  '.sqlite',
  '.db',
  '.db-wal',
  '.db-shm',
  '.wal',
  '.shm',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
]);

const OFFICE_OR_ZIP_PROMOTION_EXTS = new Set([
  '.doc',
  '.docm',
  '.ppt',
  '.pptx',
  '.pptm',
  '.xlsm',
  '.odt',
  '.ods',
  '.odp',
  '.wps',
  '.et',
  '.dps',
  '.ofd',
  '.pages',
  '.numbers',
  '.key',
  '.epub',
]);

const MDLS_PROMOTION_EXTS = new Set([
  ...Array.from(OFFICE_OR_ZIP_PROMOTION_EXTS),
  '.xls',
  '.xlsx',
  '.xlsm',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.svg',
  '.heic',
  '.heif',
  '.avif',
]);

const STRINGS_PROMOTION_EXTS = new Set([
  '.mpp',
  '.vsd',
  '.vsdx',
  '.msg',
  '.ofd',
  '.dps',
  '.wps',
  '.et',
]);

const MAX_WHISPER_DURATION_SECONDS = 45 * 60;

const ZIP_XML_HINTS: Record<string, RegExp[]> = {
  '.pptx': [/^ppt\/slides\/slide\d+\.xml$/i, /^ppt\/notesSlides\/notesSlide\d+\.xml$/i],
  '.pptm': [/^ppt\/slides\/slide\d+\.xml$/i, /^ppt\/notesSlides\/notesSlide\d+\.xml$/i],
  '.odp': [/^content\.xml$/i],
  '.odt': [/^content\.xml$/i],
  '.ods': [/^content\.xml$/i],
  '.epub': [/\.xhtml?$/i, /\.html?$/i, /toc\.ncx$/i],
  '.pages': [/^index\.xml$/i, /\/index\.xml$/i],
  '.numbers': [/^index\.xml$/i, /\/index\.xml$/i],
  '.key': [/^index\.xml$/i, /\/index\.xml$/i],
};

function normalizeExtractedText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function xmlToText(rawXml: string): string {
  const withBreaks = rawXml
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*w:tab[^>]*\/>/gi, ' ')
    .replace(/<\/\s*(w:p|a:p|text:p|p|div|tr|li|h[1-6])\s*>/gi, '\n');
  const noTags = withBreaks.replace(/<[^>]+>/g, ' ');
  return normalizeExtractedText(decodeXmlEntities(noTags));
}

function runCommand(command: string, args: string[], options?: { timeoutMs?: number }): string {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      ...(options?.timeoutMs ? { timeout: options.timeoutMs } : {}),
    });
  } catch {
    return '';
  }
}

type MediaProbe = {
  formatName: string;
  durationSec: number;
  bitRate: number;
  tags: Record<string, string>;
  streams: Array<{
    codecType: string;
    codecName: string;
    width: number;
    height: number;
    sampleRate: number;
    channels: number;
  }>;
};

function parseNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' && item.trim()) {
      result[key] = item.trim();
    }
  }
  return result;
}

function getMediaProbe(filePath: string): MediaProbe | null {
  const output = runCommand(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeoutMs: 20_000 },
  );
  if (!output.trim()) return null;

  try {
    const parsed = JSON.parse(output) as {
      format?: Record<string, unknown>;
      streams?: Array<Record<string, unknown>>;
    };
    const format = parsed?.format || {};
    const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
    return {
      formatName: String(format.format_name || ''),
      durationSec: parseNumber(format.duration),
      bitRate: parseNumber(format.bit_rate),
      tags: toStringRecord(format.tags),
      streams: streams.map((stream) => ({
        codecType: String(stream.codec_type || ''),
        codecName: String(stream.codec_name || ''),
        width: parseNumber(stream.width),
        height: parseNumber(stream.height),
        sampleRate: parseNumber(stream.sample_rate),
        channels: parseNumber(stream.channels),
      })),
    };
  } catch {
    return null;
  }
}

function formatDuration(seconds: number): string {
  const sec = Math.max(0, Math.round(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function buildMediaMetadataText(filePath: string, ext: string, probe: MediaProbe | null): string {
  const stat = fs.statSync(filePath);
  const lines: string[] = [
    '[Media Metadata]',
    `Path: ${filePath}`,
    `Ext: ${ext || 'unknown'}`,
    `Size: ${stat.size} bytes`,
  ];
  if (!probe) {
    return lines.join('\n');
  }
  if (probe.formatName) lines.push(`Container: ${probe.formatName}`);
  if (probe.durationSec > 0) lines.push(`Duration: ${formatDuration(probe.durationSec)} (${probe.durationSec.toFixed(2)}s)`);
  if (probe.bitRate > 0) lines.push(`Bitrate: ${probe.bitRate} bps`);

  for (const stream of probe.streams) {
    if (!stream.codecType) continue;
    if (stream.codecType === 'video') {
      const resolution = stream.width > 0 && stream.height > 0 ? `${stream.width}x${stream.height}` : 'unknown';
      lines.push(`Video: codec=${stream.codecName || 'unknown'}, resolution=${resolution}`);
    } else if (stream.codecType === 'audio') {
      lines.push(
        `Audio: codec=${stream.codecName || 'unknown'}, channels=${stream.channels || 0}, sample_rate=${stream.sampleRate || 0}`,
      );
    } else {
      lines.push(`Stream: type=${stream.codecType}, codec=${stream.codecName || 'unknown'}`);
    }
  }

  const tagEntries = Object.entries(probe.tags).slice(0, 12);
  for (const [key, value] of tagEntries) {
    lines.push(`Tag.${key}: ${value}`);
  }
  return lines.join('\n');
}

function extractImageOcr(filePath: string): string {
  if (!IMAGE_EXTS.has(path.extname(filePath).toLowerCase())) return '';
  const output = runCommand(
    'tesseract',
    [filePath, 'stdout', '-l', 'chi_sim+eng', '--oem', '1', '--psm', '6'],
    { timeoutMs: 45_000 },
  );
  const normalized = normalizeExtractedText(output);
  if (normalized.length >= 10) return normalized;
  const fallback = runCommand(
    'tesseract',
    [filePath, 'stdout', '-l', 'eng', '--oem', '1', '--psm', '6'],
    { timeoutMs: 30_000 },
  );
  return normalizeExtractedText(fallback);
}

function extractWithWhisper(filePath: string, durationSec: number): string {
  const ext = path.extname(filePath).toLowerCase();
  if (!AUDIO_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) return '';
  if (durationSec > MAX_WHISPER_DURATION_SECONDS) return '';

  const whisperModel = process.env.KB_WHISPER_MODEL?.trim() || 'tiny';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-whisper-'));
  try {
    runCommand(
      'whisper',
      [
        filePath,
        '--model',
        whisperModel,
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
      { timeoutMs: 10 * 60 * 1000 },
    );
    const txtFiles = fs.readdirSync(tmpDir).filter((file) => file.toLowerCase().endsWith('.txt'));
    if (txtFiles.length === 0) return '';
    const transcript = fs.readFileSync(path.join(tmpDir, txtFiles[0]), 'utf8');
    return normalizeExtractedText(transcript);
  } catch {
    return '';
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
  }
}

function extractWithStrings(filePath: string): string {
  const raw = runCommand('strings', ['-n', '8', filePath], { timeoutMs: 20_000 });
  if (!raw.trim()) return '';
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && /[A-Za-z0-9\u4e00-\u9fff]/.test(line))
    .slice(0, 220);
  return normalizeExtractedText(lines.join('\n'));
}

function extractWithPdftotext(filePath: string): string {
  const output = runCommand('pdftotext', ['-layout', filePath, '-'], { timeoutMs: 90_000 });
  return normalizeExtractedText(output);
}

function extractWithTextutil(filePath: string): string {
  if (process.platform !== 'darwin') return '';
  const output = runCommand('/usr/bin/textutil', ['-convert', 'txt', '-stdout', filePath]);
  return normalizeExtractedText(output);
}

function extractLegacyDocText(filePath: string): string {
  const antiwordOutput = runCommand('antiword', [filePath], { timeoutMs: 90_000 });
  const antiwordText = normalizeExtractedText(antiwordOutput);
  if (antiwordText.length >= 20) return antiwordText;

  const catdocOutput = runCommand('catdoc', [filePath], { timeoutMs: 90_000 });
  const catdocText = normalizeExtractedText(catdocOutput);
  if (catdocText.length >= 20) return catdocText;

  return '';
}

function extractWithMdls(filePath: string): string {
  if (process.platform !== 'darwin') return '';
  const output = runCommand('/usr/bin/mdls', ['-name', 'kMDItemTextContent', '-raw', filePath]);
  const normalized = normalizeExtractedText(output);
  if (!normalized || normalized === '(null)') return '';
  return normalized;
}

function listZipEntries(filePath: string): string[] {
  const output = runCommand('unzip', ['-Z1', filePath]);
  if (!output.trim()) return [];
  return output
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractZipEntriesText(filePath: string, entryPatterns: RegExp[]): string {
  const entries = listZipEntries(filePath)
    .filter((entry) => entryPatterns.some((pattern) => pattern.test(entry)))
    .slice(0, 120);
  if (entries.length === 0) return '';

  const chunks: string[] = [];
  for (const entry of entries) {
    const raw = runCommand('unzip', ['-p', filePath, entry]);
    if (!raw.trim()) continue;
    const text = xmlToText(raw);
    if (!text) continue;
    chunks.push(text);
    if (chunks.join('\n').length > 240_000) break;
  }
  return normalizeExtractedText(chunks.join('\n\n'));
}

async function tryAdaptiveExtraction(filePath: string, baseName: string, ext: string): Promise<ParseResult | null> {
  if (ext === '.ods' || ext === '.xlsm') {
    try {
      return await parseExcel(filePath, baseName);
    } catch {
      // fallback to system extraction
    }
  }

  if (AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)) {
    const probe = getMediaProbe(filePath);
    const transcript = extractWithWhisper(filePath, probe?.durationSec || 0);
    const metadataText = buildMediaMetadataText(filePath, ext, probe);
    const content = normalizeExtractedText([
      metadataText,
      transcript ? `\n[Transcript]\n${transcript}` : '',
    ].join('\n\n'));
    if (content) {
      return { title: baseName, content, extra: {} };
    }
  }

  if (IMAGE_EXTS.has(ext)) {
    const probe = getMediaProbe(filePath);
    const metadataText = buildMediaMetadataText(filePath, ext, probe);
    const ocrText = extractImageOcr(filePath);
    const content = normalizeExtractedText([
      metadataText,
      ocrText ? `\n[OCR]\n${ocrText}` : '\n[OCR]\n未识别到可读文字',
    ].join('\n\n'));
    if (content) {
      return { title: baseName, content, extra: {} };
    }
  }

  if (ext === '.zip') {
    const entries = listZipEntries(filePath).slice(0, 200);
    if (entries.length > 0) {
      return {
        title: baseName,
        content: normalizeExtractedText(
          [
            '[Archive]',
            `Path: ${filePath}`,
            `Entries: ${entries.length}`,
            entries.map((entry) => `- ${entry}`).join('\n'),
          ].join('\n'),
        ),
        extra: {},
      };
    }
  }

  const zipPatterns = ZIP_XML_HINTS[ext];
  if (zipPatterns) {
    const zipText = extractZipEntriesText(filePath, zipPatterns);
    if (zipText) {
      return { title: baseName, content: zipText, extra: {} };
    }
  }

  if (ext === '.doc') {
    const legacyDocText = extractLegacyDocText(filePath);
    if (legacyDocText) {
      return { title: baseName, content: legacyDocText, extra: {} };
    }
  }

  if (OFFICE_OR_ZIP_PROMOTION_EXTS.has(ext)) {
    const textutilText = extractWithTextutil(filePath);
    if (textutilText) {
      return { title: baseName, content: textutilText, extra: {} };
    }
  }

  if (MDLS_PROMOTION_EXTS.has(ext)) {
    const mdlsText = extractWithMdls(filePath);
    if (mdlsText) {
      return { title: baseName, content: mdlsText, extra: {} };
    }
  }

  if (STRINGS_PROMOTION_EXTS.has(ext)) {
    const stringsText = extractWithStrings(filePath);
    if (stringsText) {
      return { title: baseName, content: stringsText, extra: {} };
    }
  }

  return null;
}

export interface ParsedKnowledgeFile {
  title: string;
  content: string;
  mode: 'full' | 'reference';
  parseError: string;
  metadata: DocumentMetadata;
}

export function buildReferenceContent(filePath: string, reason: string): string {
  const ext = path.extname(filePath).toLowerCase() || 'unknown';
  const stat = fs.statSync(filePath);
  const fallbackReason = reason || 'reference_only';
  return [
    '[Reference Only]',
    `Path: ${filePath}`,
    `Ext: ${ext}`,
    `Size: ${stat.size} bytes`,
    `Reason: ${fallbackReason}`,
    'This source is registered in knowledge base as reference-only.',
    'When answering, prioritize reading source file/path directly if needed.',
  ].join('\n');
}

function isLikelyBinary(pathLike: string): boolean {
  const ext = path.extname(pathLike).toLowerCase();
  return REFERENCE_ONLY_EXTS.has(ext) || LIKELY_BINARY_EXTS.has(ext);
}

function parsePlainTextSafe(filePath: string, baseName: string): ParseResult {
  const buf = fs.readFileSync(filePath);
  if (buf.includes(0)) {
    throw new Error('binary_or_unsupported');
  }
  const content = decodeTextBuffer(buf);
  const ext = path.extname(filePath).toLowerCase();
  const title = ext === '.md' ? extractMdTitle(content, baseName) : baseName;
  return { title, content, extra: {} };
}

function decodeTextBuffer(buf: Buffer): string {
  const hasUtf8Bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  if (hasUtf8Bom) {
    return buf.subarray(3).toString('utf8');
  }

  const hasUtf16LeBom = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
  if (hasUtf16LeBom) {
    return buf.subarray(2).toString('utf16le');
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // fall through
  }

  const fallbackEncodings = ['gb18030', 'utf-16le', 'latin1'];
  for (const encoding of fallbackEncodings) {
    try {
      // TextDecoder supports these encodings when ICU data is available.
      return new TextDecoder(encoding, { fatal: true }).decode(buf);
    } catch {
      // continue
    }
  }
  return buf.toString('utf8');
}

export async function parseFileForKnowledge(filePath: string): Promise<ParsedKnowledgeFile> {
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, ext);
  const stat = fs.statSync(filePath);
  const baseMetadata = {
    wordCount: 0,
    charCount: 0,
    fileSize: stat.size,
    mimeType: MIME_MAP[ext] || 'application/octet-stream',
  };

  if (REFERENCE_ONLY_EXTS.has(ext)) {
    const promoted = await tryAdaptiveExtraction(filePath, baseName, ext);
    const promotedContent = promoted?.content?.trim() || '';
    if (promotedContent) {
      return {
        title: promoted?.title || baseName,
        content: promotedContent,
        mode: 'full',
        parseError: '',
        metadata: {
          ...baseMetadata,
          ...promoted?.extra,
          wordCount: countWords(promotedContent),
          charCount: promotedContent.length,
        },
      };
    }
    return {
      title: baseName,
      content: buildReferenceContent(filePath, `unsupported_ext_${ext || 'unknown'}`),
      mode: 'reference',
      parseError: `unsupported_ext_${ext || 'unknown'}`,
      metadata: baseMetadata,
    };
  }

  if (!FULL_PARSE_EXTS.has(ext) && isLikelyBinary(filePath)) {
    const promoted = await tryAdaptiveExtraction(filePath, baseName, ext);
    const promotedContent = promoted?.content?.trim() || '';
    if (promotedContent) {
      return {
        title: promoted?.title || baseName,
        content: promotedContent,
        mode: 'full',
        parseError: '',
        metadata: {
          ...baseMetadata,
          ...promoted?.extra,
          wordCount: countWords(promotedContent),
          charCount: promotedContent.length,
        },
      };
    }
    return {
      title: baseName,
      content: buildReferenceContent(filePath, `binary_ext_${ext || 'unknown'}`),
      mode: 'reference',
      parseError: `binary_ext_${ext || 'unknown'}`,
      metadata: baseMetadata,
    };
  }

  try {
    const parsed = await parseDocument(filePath);
    if (!parsed.content.trim()) {
      const promoted = await tryAdaptiveExtraction(filePath, baseName, ext);
      const promotedContent = promoted?.content?.trim() || '';
      if (promotedContent) {
        return {
          title: promoted?.title || parsed.title || baseName,
          content: promotedContent,
          mode: 'full',
          parseError: '',
          metadata: {
            ...baseMetadata,
            ...promoted?.extra,
            wordCount: countWords(promotedContent),
            charCount: promotedContent.length,
          },
        };
      }
      return {
        title: parsed.title || baseName,
        content: buildReferenceContent(filePath, 'empty_content'),
        mode: 'reference',
        parseError: 'empty_content',
        metadata: parsed.metadata,
      };
    }
    return {
      title: parsed.title || baseName,
      content: parsed.content,
      mode: 'full',
      parseError: '',
      metadata: parsed.metadata,
    };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : 'parse_failed';
    const promoted = await tryAdaptiveExtraction(filePath, baseName, ext);
    const promotedContent = promoted?.content?.trim() || '';
    if (promotedContent) {
      return {
        title: promoted?.title || baseName,
        content: promotedContent,
        mode: 'full',
        parseError: '',
        metadata: {
          ...baseMetadata,
          ...promoted?.extra,
          wordCount: countWords(promotedContent),
          charCount: promotedContent.length,
        },
      };
    }
    return {
      title: baseName,
      content: buildReferenceContent(filePath, errMessage),
      mode: 'reference',
      parseError: errMessage,
      metadata: baseMetadata,
    };
  }
}

/** Extract text content from a file (backward-compatible) */
export async function parseFile(filePath: string): Promise<string> {
  const doc = await parseDocument(filePath);
  return doc.content;
}

/** Parse file into structured document with metadata */
export async function parseDocument(filePath: string): Promise<ParsedDocument> {
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const baseName = path.basename(filePath, ext);

  const base: DocumentMetadata = {
    wordCount: 0,
    charCount: 0,
    fileSize: stat.size,
    mimeType: MIME_MAP[ext] || 'application/octet-stream',
  };

  let result: { title: string; content: string; extra: Partial<DocumentMetadata> };

  if (ext === '.docx') {
    result = await parseDocx(filePath, baseName);
  } else if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm' || ext === '.ods') {
    result = await parseExcel(filePath, baseName);
  } else if (ext === '.pdf') {
    result = await parsePdf(filePath, baseName);
  } else {
    result = parsePlainTextSafe(filePath, baseName);
  }

  const content = result.content;
  const metadata: DocumentMetadata = {
    ...base,
    ...result.extra,
    wordCount: countWords(content),
    charCount: content.length,
  };

  return { title: result.title, content, metadata };
}

/** Count words (handles both CJK and Latin text) */
function countWords(text: string): number {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length || 0;
  const latin = text.match(/[a-zA-Z]+/g)?.length || 0;
  return cjk + latin;
}

/** Extract title from markdown (first heading or first line) */
function extractMdTitle(content: string, fallback: string): string {
  const headingMatch = content.match(/^#\s+(.+)/m);
  if (headingMatch) return headingMatch[1].trim();
  const firstLine = content.split('\n').find(l => l.trim());
  return firstLine?.slice(0, 60) || fallback;
}

type ParseResult = { title: string; content: string; extra: Partial<DocumentMetadata> };

async function parseDocx(filePath: string, baseName: string): Promise<ParseResult> {
  const mammoth = await import('mammoth');
  const fileBuf = fs.readFileSync(filePath);
  const result = await mammoth.extractRawText({ buffer: fileBuf });
  const content = result.value;
  return { title: baseName, content, extra: {} };
}

async function parseExcel(filePath: string, baseName: string): Promise<ParseResult> {
  const mod = await import('xlsx');
  // CJS/ESM interop differs by runtime bundler; normalize to a single runtime object.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XLSX = (mod as any).read ? mod : ((mod as any).default ?? mod);
  const fileBuf = fs.readFileSync(filePath);
  // Parse from buffer to avoid xlsx's internal path access check on non-ASCII paths.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wb = XLSX.read(fileBuf, { type: 'buffer' } as any);
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    if (csv.trim()) parts.push(`## ${name}\n${csv}`);
  }
  return {
    title: baseName,
    content: parts.join('\n\n'),
    extra: { sheetNames: wb.SheetNames },
  };
}

async function parsePdf(filePath: string, baseName: string): Promise<ParseResult> {
  const pdftotextContent = extractWithPdftotext(filePath);
  if (pdftotextContent) {
    return {
      title: baseName,
      content: pdftotextContent,
      extra: {},
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import('pdf-parse' as any);
  const buf = fs.readFileSync(filePath);

  // v2 API: `new PDFParse({ data }).getText()`
  const PDFParseCtor = mod?.PDFParse || mod?.default?.PDFParse;
  if (typeof PDFParseCtor === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parser = new PDFParseCtor({ data: new Uint8Array(buf) }) as any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await parser.getText() as any;
      return {
        title: result?.info?.Title || baseName,
        content: typeof result?.text === 'string' ? result.text : '',
        extra: { pageCount: Number(result?.total ?? result?.numpages ?? 0) || undefined },
      };
    } finally {
      try {
        if (typeof parser?.destroy === 'function') await parser.destroy();
      } catch {
        // ignore parser cleanup errors
      }
    }
  }

  // Backward compatibility for v1 function API.
  const candidate = mod?.default ?? mod;
  const pdfParse = typeof candidate === 'function'
    ? candidate
    : (candidate?.default ?? candidate);
  if (typeof pdfParse === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await pdfParse(buf) as any;
    return {
      title: data?.info?.Title || baseName,
      content: typeof data?.text === 'string' ? data.text : '',
      extra: { pageCount: Number(data?.numpages ?? 0) || undefined },
    };
  }

  throw new Error('pdf_parse_unavailable');
}
