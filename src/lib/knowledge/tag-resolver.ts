/**
 * Tag resolver — 将 agent 面向的标签名解析为内部 id，并提供 catalog 便于 prompt 拼接。
 *
 * 对外使用 kb_tags.name（UNIQUE，用户可读）；内部 searchWithMeta 需要 tag id 数组。
 */
import { getTagByName, listTags, type KbTag } from '@/lib/stores/tag-store';

export interface ResolvedTags {
  /** 命中的 tag id 列表 */
  ids: string[];
  /** 命中的原始 KbTag 对象 */
  tags: KbTag[];
  /** 未命中的名字（不存在或已删除） */
  missing: string[];
}

/**
 * 按名字解析多个标签。大小写敏感（与入库一致），重复名会被去重。
 */
export function resolveTagNames(names: readonly string[]): ResolvedTags {
  const seen = new Set<string>();
  const ids: string[] = [];
  const tags: KbTag[] = [];
  const missing: string[] = [];

  for (const raw of names) {
    const name = raw?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const tag = getTagByName(name);
    if (tag) {
      ids.push(tag.id);
      tags.push(tag);
    } else {
      missing.push(name);
    }
  }

  return { ids, tags, missing };
}

/**
 * 按名字解析单个标签。
 */
export function resolveTagName(name: string): KbTag | undefined {
  return getTagByName(name?.trim());
}

export interface TagCatalogEntry {
  name: string;
  category: string;
  usage_count: number;
}

/**
 * 列出可供 agent 选择的标签（按热度降序）。用于 prompt section 与 list_knowledge_tags 工具。
 */
export function listTagCatalog(opts?: { limit?: number }): TagCatalogEntry[] {
  const limit = opts?.limit ?? 50;
  return listTags()
    .slice(0, limit)
    .map((t) => ({
      name: t.name,
      category: t.category,
      usage_count: t.usage_count,
    }));
}
