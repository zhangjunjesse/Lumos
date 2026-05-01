import type { BrowserProfileSummary } from '@/types';

const GROUP_PREFIX = 'AdsPower 分组:';
const SERIAL_PREFIX = 'AdsPower 序号:';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface AdsPowerProfileMetadata {
  group: string;
  serialNumber: string;
  customNotes: string;
}

export function parseAdsPowerProfileMetadata(notes: string): AdsPowerProfileMetadata {
  const customLines: string[] = [];
  let group = '';
  let serialNumber = '';

  for (const rawLine of notes.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith(GROUP_PREFIX)) {
      group = normalizeText(line.slice(GROUP_PREFIX.length));
      continue;
    }
    if (line.startsWith(SERIAL_PREFIX)) {
      serialNumber = normalizeText(line.slice(SERIAL_PREFIX.length));
      continue;
    }
    customLines.push(line);
  }

  return {
    group,
    serialNumber,
    customNotes: customLines.join('\n'),
  };
}

export function formatAdsPowerProfileNotes(
  profile: Pick<BrowserProfileSummary, 'group' | 'serial_number'>,
  existingNotes = '',
): string {
  const existing = parseAdsPowerProfileMetadata(existingNotes);
  const lines = [
    normalizeText(profile.group) ? `${GROUP_PREFIX} ${normalizeText(profile.group)}` : '',
    normalizeText(profile.serial_number) ? `${SERIAL_PREFIX} ${normalizeText(profile.serial_number)}` : '',
    existing.customNotes,
  ].filter(Boolean);
  return lines.join('\n');
}

export function getAdsPowerProfileGroup(notes: string): string {
  return parseAdsPowerProfileMetadata(notes).group || '未分组';
}

export function getAdsPowerProfileSerialNumber(notes: string): string {
  return parseAdsPowerProfileMetadata(notes).serialNumber;
}
