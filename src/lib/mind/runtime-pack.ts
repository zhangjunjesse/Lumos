import { getSetting } from '@/lib/db';
import { buildMemoryContextForPrompt } from '@/lib/memory/runtime';
import { getMindPersonaProfile } from '@/lib/mind/profile';
import { getMindRulesProfile } from '@/lib/mind/rules-profile';

export interface MindRuntimePackSection {
  key: 'persona' | 'rules' | 'memory';
  title: string;
  enabled: boolean;
  lineCount: number;
  preview: string;
}

export interface MindRuntimePackResult {
  additionalContext: string;
  sourceOrder: string[];
  sections: MindRuntimePackSection[];
  memoryItems: number;
}

function cleanLine(value: string, max = 320): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

function lineCount(value: string): number {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .length;
}

function countMemoryItems(value: string): number {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s/.test(line))
    .length;
}

function buildPersonaSection(): string {
  const persona = getMindPersonaProfile();
  return [
    '<lumos_persona>',
    `Identity: ${cleanLine(persona.identity, 160)}`,
    `Relationship: ${cleanLine(persona.relationship, 220)}`,
    `Tone: ${cleanLine(persona.tone, 160)}`,
    `Mission: ${cleanLine(persona.mission, 220)}`,
    '</lumos_persona>',
  ].join('\n');
}

function buildRulesSection(): string {
  const rules = getMindRulesProfile();
  return [
    '<lumos_rules>',
    'Priority order:',
    '1. Follow platform and safety policies first.',
    '2. Follow explicit user instruction in this turn.',
    '3. Follow Lumos persona and collaboration rules.',
    '4. Use persisted memory only when relevant.',
    `Collaboration: ${cleanLine(rules.collaborationStyle, 260)}`,
    `Response rules: ${cleanLine(rules.responseRules, 260)}`,
    `Safety boundaries: ${cleanLine(rules.safetyBoundaries, 260)}`,
    `Memory policy: ${cleanLine(rules.memoryPolicy, 260)}`,
    '</lumos_rules>',
  ].join('\n');
}

export function buildMindRuntimePack(params: {
  sessionId: string;
  projectPath?: string;
  prompt: string;
  maxMemoryItems?: number;
  trackMemoryUsage?: boolean;
}): MindRuntimePackResult {
  const sourceOrder = [
    'platform_safety',
    'user_current_turn',
    'lumos_persona',
    'lumos_rules',
    'persisted_memory',
  ];

  const personaSection = buildPersonaSection();
  const rulesSection = buildRulesSection();
  const memorySection = buildMemoryContextForPrompt({
    sessionId: params.sessionId,
    projectPath: params.projectPath,
    prompt: params.prompt,
    maxItems: params.maxMemoryItems,
    trackUsage: params.trackMemoryUsage !== false,
  });

  const additionalContext = [personaSection, rulesSection, memorySection]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const memoryEnabled = getSetting('memory_system_enabled') !== 'false';

  const sections: MindRuntimePackSection[] = [
    {
      key: 'persona',
      title: 'Persona',
      enabled: true,
      lineCount: lineCount(personaSection),
      preview: cleanLine(personaSection.replace(/<\/?lumos_persona>/g, ''), 220),
    },
    {
      key: 'rules',
      title: 'Rules',
      enabled: true,
      lineCount: lineCount(rulesSection),
      preview: cleanLine(rulesSection.replace(/<\/?lumos_rules>/g, ''), 240),
    },
    {
      key: 'memory',
      title: 'Memory',
      enabled: memoryEnabled,
      lineCount: lineCount(memorySection),
      preview: memorySection
        ? cleanLine(memorySection.replace(/<\/?lumos_memory>/g, ''), 240)
        : 'No relevant memory selected for this prompt.',
    },
  ];

  return {
    additionalContext,
    sourceOrder,
    sections,
    memoryItems: countMemoryItems(memorySection),
  };
}
