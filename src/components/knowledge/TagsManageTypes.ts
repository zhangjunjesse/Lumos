export type TagCategory = "domain" | "tech" | "doctype" | "project" | "custom";

export interface TagRow {
  id: string;
  name: string;
  category: TagCategory;
  color: string;
  usage_count: number;
}

export type EditingState = {
  mode: "rename" | "merge" | "delete" | "batchDelete" | "batchMerge";
  tagId: string;
  name: string;
  draftName?: string;
  draftCategory?: TagCategory;
  mergeTargetId?: string;
  batchIds?: string[];
};

export const CATEGORY_LABEL: Record<TagCategory, string> = {
  domain: "领域",
  tech: "技术",
  doctype: "类型",
  project: "项目",
  custom: "自定义",
};

export const CATEGORIES: TagCategory[] = ["domain", "tech", "doctype", "project", "custom"];
