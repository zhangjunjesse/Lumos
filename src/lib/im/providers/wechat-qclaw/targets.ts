/**
 * WeChat (QClaw) Provider — Target Directory
 */

import type { IMTarget, ListTargetsOptions } from '../../core/types';
import type { QClawClient, QClawContact } from './client';

const PAGE_SIZE_DEFAULT = 50;

function toTarget(c: QClawContact): IMTarget {
  return {
    id: c.id,
    name: c.name || c.id,
    kind: c.kind ?? 'direct',
    description: c.description,
  };
}

export async function listQClawTargets(
  client: QClawClient,
  opts: ListTargetsOptions = {},
): Promise<IMTarget[]> {
  const limit = opts.limit ?? PAGE_SIZE_DEFAULT;
  const contacts = await client.listContacts(opts.query, limit);
  return contacts
    .filter((c) => !opts.kind || (c.kind ?? 'direct') === opts.kind)
    .slice(0, limit)
    .map(toTarget);
}

export async function resolveQClawTarget(
  client: QClawClient,
  query: string,
): Promise<IMTarget | null> {
  if (!query.trim()) return null;
  const contacts = await client.listContacts(query, 50);
  const exact =
    contacts.find((c) => c.id === query) ?? contacts.find((c) => c.name === query);
  if (exact) return toTarget(exact);
  const lowered = query.toLowerCase();
  const fuzzy = contacts.find((c) => (c.name || '').toLowerCase().includes(lowered));
  return fuzzy ? toTarget(fuzzy) : null;
}
