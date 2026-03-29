import type { Task } from '@/lib/task-management/types';
import type { SearchTarget } from './planner-types';
import {
  EXTERNAL_SEARCH_INTENT_PATTERNS,
  LOCAL_SEARCH_NEGATION_PATTERNS,
  REMEDIATION_INTENT_PATTERNS,
  REPORT_INTENT_PATTERNS,
  SECURITY_RESEARCH_PATTERNS,
} from './planner-types';

export function matchesAny(source: string, patterns: string[]): boolean {
  return patterns.some((pattern) => source.includes(pattern.toLowerCase()));
}

export function matchesIntent(
  source: string,
  options: {
    genericPatterns: string[];
    explicitPositivePatterns?: string[];
    negatedPatterns?: string[];
  },
): boolean {
  if (matchesAny(source, options.explicitPositivePatterns ?? [])) {
    return true;
  }

  if (matchesAny(source, options.negatedPatterns ?? [])) {
    return false;
  }

  return matchesAny(source, options.genericPatterns);
}

export function shouldPreferEvidenceSearchFlow(normalized: string, needsImplementation: boolean): boolean {
  if (needsImplementation) {
    return false;
  }

  const hasResearchIntent = matchesAny(normalized, REPORT_INTENT_PATTERNS);
  const hasSecurityTopic = matchesAny(normalized, SECURITY_RESEARCH_PATTERNS);
  const hasRemediationIntent = matchesAny(normalized, REMEDIATION_INTENT_PATTERNS);

  return (hasResearchIntent && hasSecurityTopic) || (hasSecurityTopic && hasRemediationIntent);
}

export function extractUrls(source: string): string[] {
  const matches = source.match(/https?:\/\/[^\s<>"'`，。；：！？、）】》」』]+/giu) ?? [];
  const sanitized = matches
    .map((match) => match.replace(/[),.;!?，。；：！？、）】》」』]+$/u, ''))
    .filter((match) => match.length > 0);
  return Array.from(new Set(sanitized));
}

export function hasCjkCharacters(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

export function cleanSearchQuery(value: string): string {
  return value
    .replace(/^[:：\s]+/u, '')
    .replace(/^(?:在|去|到)\s*/u, '')
    .replace(/^(?:百度|baidu|谷歌|google|必应|bing|duckduckgo)\s*/iu, '')
    .replace(/^(?:搜索|搜一下|搜一搜|查一下|查询|检索|search(?:\s+for)?)\s*/iu, '')
    .replace(/\s*(?:然后|接着|再|并且|并|最后).*/u, '')
    .replace(/\s*(?:截图|截个图|保存截图|通知我|告诉我|发给我|导出(?:成)?\s*pdf|导出|变成\s*pdf|生成\s*pdf).*/iu, '')
    .replace(/[""''']+/gu, '')
    .trim();
}

export function extractExplicitSearchQuery(source: string): string | undefined {
  const clauses = source
    .replace(/[。！？!?]/gu, '\n')
    .replace(/[；;]/gu, '\n')
    .split('\n')
    .flatMap((part) => part.split(/[，,]/u))
    .map((part) => part.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const match = clause.match(/(?:搜索|搜一下|搜一搜|查一下|查询|检索|search(?:\s+for)?)\s*[:：]?\s*(.+)$/iu);
    if (!match) {
      continue;
    }

    const query = cleanSearchQuery(match[1] ?? '');
    if (query.length >= 2) {
      return query;
    }
  }

  return undefined;
}

export function deriveTopicQuery(summary: string): string | undefined {
  const query = summary
    .replace(/^(?:(?:请|麻烦)\s*)?(?:帮我|给我)?\s*(?:做|整理|写|生成|提供|来)?\s*一份\s*/u, '')
    .replace(/^(?:请|麻烦|帮我|给我)\s*/u, '')
    .replace(/^(?:调研(?:一下)?|研究(?:一下)?|分析(?:一下)?|整理(?:一下)?|汇总(?:一下)?|总结(?:一下)?|看一下|看看)\s*/u, '')
    .replace(/^(?:关于|有关)\s*/u, '')
    .replace(/[，,。；;].*$/u, '')
    .replace(/\s*(?:并.*|然后.*|最后.*)$/u, '')
    .replace(/\s*(?:的)?(?:调研|研究|报告|分析|总结|汇总)\s*$/u, '')
    .trim();

  const cleaned = cleanSearchQuery(query)
    .replace(/^(?:调研(?:一下)?|研究(?:一下)?|分析(?:一下)?|整理(?:一下)?|汇总(?:一下)?|总结(?:一下)?|看一下|看看)\s*/u, '')
    .trim();

  return cleaned.length >= 2 ? cleaned : undefined;
}

export function resolveSearchTarget(normalized: string, query: string): SearchTarget {
  if (matchesAny(normalized, ['百度', 'baidu'])) {
    return {
      engine: 'baidu',
      engineLabel: '百度',
      query,
      url: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
    };
  }

  if (matchesAny(normalized, ['谷歌', 'google'])) {
    return {
      engine: 'google',
      engineLabel: 'Google',
      query,
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    };
  }

  if (matchesAny(normalized, ['必应', 'bing'])) {
    return {
      engine: 'bing',
      engineLabel: 'Bing',
      query,
      url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    };
  }

  if (matchesAny(normalized, ['duckduckgo', 'duck duck go', 'ddg'])) {
    return {
      engine: 'duckduckgo',
      engineLabel: 'DuckDuckGo',
      query,
      url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    };
  }

  if (hasCjkCharacters(query)) {
    return {
      engine: 'baidu',
      engineLabel: '百度',
      query,
      url: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
    };
  }

  return {
    engine: 'bing',
    engineLabel: 'Bing',
    query,
    url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
  };
}

export function inferSearchTarget(
  task: Task,
  text: string,
  normalized: string,
  preferEvidenceSearch: boolean = false,
): SearchTarget | null {
  if (!matchesAny(normalized, EXTERNAL_SEARCH_INTENT_PATTERNS) && !preferEvidenceSearch) {
    return null;
  }

  if (matchesAny(normalized, LOCAL_SEARCH_NEGATION_PATTERNS)) {
    return null;
  }

  const query = extractExplicitSearchQuery(text) ?? deriveTopicQuery(task.summary);
  if (!query) {
    return null;
  }

  return resolveSearchTarget(normalized, query);
}
