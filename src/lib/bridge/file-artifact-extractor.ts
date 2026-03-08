import path from 'node:path';

const MEDIA_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg', '.ico',
  '.mp4', '.mov', '.webm', '.mkv', '.avi',
  '.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg',
]);

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg', '.ico',
]);

function isAbsolutePath(input: string): boolean {
  return input.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(input);
}

function hasLikelyFileName(input: string): boolean {
  const normalized = input.replace(/\\/g, '/');
  const fileName = normalized.split('/').pop() || '';
  return /\.[a-zA-Z0-9]{1,16}$/.test(fileName);
}

function cleanPathCandidate(raw: string): string | null {
  let candidate = raw.trim();
  if (!candidate) return null;

  candidate = candidate
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/[),.;!?，。；：]+$/g, '');

  if (candidate.startsWith('file://')) {
    candidate = decodeURIComponent(candidate.slice('file://'.length));
  }

  if (!isAbsolutePath(candidate)) return null;
  if (!hasLikelyFileName(candidate)) return null;
  if (candidate.includes('\n') || candidate.includes('\r')) return null;

  return candidate;
}

function extractPathCandidatesFromText(text: string): string[] {
  const candidates = new Set<string>();

  const backtickRegex = /`([^`]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = backtickRegex.exec(text)) !== null) {
    const cleaned = cleanPathCandidate(match[1] || '');
    if (cleaned) candidates.add(cleaned);
  }

  const directiveRegex = /^FEISHU_SEND_FILE::(.+)$/gm;
  while ((match = directiveRegex.exec(text)) !== null) {
    const cleaned = cleanPathCandidate(match[1] || '');
    if (cleaned) candidates.add(cleaned);
  }

  const quotedRegex = /["']((?:\/|[a-zA-Z]:[\\/])[^"'\n]+?\.[a-zA-Z0-9]{1,16})["']/g;
  while ((match = quotedRegex.exec(text)) !== null) {
    const cleaned = cleanPathCandidate(match[1] || '');
    if (cleaned) candidates.add(cleaned);
  }

  const bareRegex = /(?:^|[\s(])((?:\/|[a-zA-Z]:[\\/])[^\s'"`<>]+?\.[a-zA-Z0-9]{1,16})(?=$|[\s),.;!?，。；：])/g;
  while ((match = bareRegex.exec(text)) !== null) {
    const cleaned = cleanPathCandidate(match[1] || '');
    if (cleaned) candidates.add(cleaned);
  }

  return Array.from(candidates);
}

function extractPathCandidatesFromToolResult(resultContent: string): string[] {
  const candidates = new Set<string>();
  try {
    const parsed = JSON.parse(resultContent) as Record<string, unknown>;
    const images = Array.isArray(parsed.images) ? parsed.images : [];
    for (const image of images) {
      if (typeof image === 'string') {
        const cleaned = cleanPathCandidate(image);
        if (cleaned) candidates.add(cleaned);
        continue;
      }
      if (image && typeof image === 'object') {
        const obj = image as Record<string, unknown>;
        const cleaned = cleanPathCandidate(
          typeof obj.path === 'string'
            ? obj.path
            : typeof obj.localPath === 'string'
              ? obj.localPath
              : typeof obj.filePath === 'string'
                ? obj.filePath
                : '',
        );
        if (cleaned) candidates.add(cleaned);
      }
    }
  } catch {
    // ignore non-JSON tool outputs
  }
  return Array.from(candidates);
}

function extractFromStructuredBlocks(rawContent: string): string[] {
  const candidates = new Set<string>();
  try {
    const blocks = JSON.parse(rawContent) as Array<{
      type?: string;
      text?: string;
      content?: string;
    }>;
    if (!Array.isArray(blocks)) return [];

    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        for (const p of extractPathCandidatesFromText(block.text)) candidates.add(p);
        continue;
      }
      if (block.type === 'tool_result' && typeof block.content === 'string') {
        for (const p of extractPathCandidatesFromToolResult(block.content)) candidates.add(p);
        for (const p of extractPathCandidatesFromText(block.content)) candidates.add(p);
      }
    }
  } catch {
    // ignore parse errors
  }
  return Array.from(candidates);
}

export function isImagePath(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

export function isMediaPath(filePath: string): boolean {
  return MEDIA_EXTS.has(path.extname(filePath).toLowerCase());
}

export function extractAssistantArtifactPaths(rawContent: string): {
  allPaths: string[];
  mediaPaths: string[];
  imagePaths: string[];
} {
  const all = new Set<string>();
  const trimmed = rawContent.trim();

  if (trimmed.startsWith('[')) {
    for (const p of extractFromStructuredBlocks(trimmed)) all.add(p);
  }
  for (const p of extractPathCandidatesFromText(rawContent)) all.add(p);

  const allPaths = Array.from(all);
  return {
    allPaths,
    mediaPaths: allPaths.filter(isMediaPath),
    imagePaths: allPaths.filter(isImagePath),
  };
}

