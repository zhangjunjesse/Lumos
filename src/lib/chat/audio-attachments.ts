export const AUDIO_EXTENSIONS = [
  'm4a',
  'mp3',
  'wav',
  'ogg',
  'aac',
  'amr',
  'silk',
  'flac',
  'webm',
  'opus',
] as const;

const AUDIO_EXTENSION_SET = new Set<string>(AUDIO_EXTENSIONS);

const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  aac: 'audio/aac',
  amr: 'audio/amr',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  silk: 'audio/silk',
  wav: 'audio/wav',
  webm: 'audio/webm',
};

export interface AudioFileLike {
  name?: string;
  filename?: string;
  type?: string;
  mediaType?: string;
}

export interface AudioTranscriptionReference {
  filePath: string;
  name: string;
  type?: string;
  size?: number;
}

export function getFileExtension(name: string | undefined): string {
  const clean = (name || '').split(/[?#]/, 1)[0] || '';
  const index = clean.lastIndexOf('.');
  if (index < 0) return '';
  return clean.slice(index + 1).toLowerCase();
}

export function isAudioMime(type: string | undefined): boolean {
  return Boolean(type?.toLowerCase().startsWith('audio/'));
}

export function isAudioFilename(name: string | undefined): boolean {
  const ext = getFileExtension(name);
  return Boolean(ext && AUDIO_EXTENSION_SET.has(ext));
}

export function inferAudioMimeFromFilename(
  name: string | undefined,
  fallback = 'application/octet-stream',
): string {
  const ext = getFileExtension(name);
  return AUDIO_MIME_BY_EXTENSION[ext] || fallback;
}

export function isAudioFileLike(file: AudioFileLike): boolean {
  return isAudioMime(file.mediaType || file.type)
    || isAudioFilename(file.filename || file.name);
}

export function formatAudioSize(size: number | undefined): string {
  if (!size || size <= 0) return '未知大小';
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function buildAudioTranscriptionInstruction(refs: AudioTranscriptionReference[]): string {
  if (refs.length === 0) return '';
  const lines = [
    'The user attached audio file(s). Before answering, transcribe them with the Lumos speech MCP tool.',
    '',
    'Audio attachments:',
  ];
  for (const ref of refs) {
    lines.push(`- file_path: ${ref.filePath}`);
    lines.push(`  name: ${ref.name}`);
    lines.push(`  mime_type: ${ref.type || inferAudioMimeFromFilename(ref.name)}`);
    lines.push(`  size: ${formatAudioSize(ref.size)}`);
  }
  lines.push('');
  lines.push('Use the `transcribe_audio` MCP tool with `file_path` for each audio file, then summarize or answer based on the transcript. Do not use Read/Bash/ffmpeg/local whisper or external skills as the ASR path. If the tool fails, report the tool error; audio splitting/compression belongs inside the MCP/runtime, not the agent turn.');
  return lines.join('\n');
}
