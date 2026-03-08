import { listMemoriesForContext, type MemoryRecord } from '@/lib/db/memories';

function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;

  const words1 = new Set(s1.split(/\s+/));
  const words2 = new Set(s2.split(/\s+/));
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

export function detectMemoryConflict(params: {
  content: string;
  scope: 'global' | 'project' | 'session';
  category: string;
  projectPath?: string;
  sessionId?: string;
}): MemoryRecord | null {
  const memories = listMemoriesForContext({
    projectPath: params.projectPath,
    sessionId: params.sessionId,
    limit: 100,
  });

  const candidates = memories.filter(m =>
    m.scope === params.scope &&
    m.category === params.category &&
    !m.is_archived
  );

  for (const memory of candidates) {
    const similarity = calculateSimilarity(params.content, memory.content);
    if (similarity > 0.7) {
      return memory;
    }
  }

  return null;
}
