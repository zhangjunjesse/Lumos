// 记忆系统术语翻译映射

export const categoryLabels: Record<string, string> = {
  preference: '偏好',
  constraint: '规则',
  fact: '知识',
  workflow: '流程',
  other: '其他',
};

export const scopeLabels: Record<string, string> = {
  global: '所有项目',
  project: '当前项目',
  session: '本次对话',
};

export const categoryIcons: Record<string, string> = {
  preference: '💡',
  constraint: '📏',
  fact: '📚',
  workflow: '🔄',
  other: '📝',
};

export function getCategoryLabel(category: string): string {
  return categoryLabels[category] || category;
}

export function getScopeLabel(scope: string): string {
  return scopeLabels[scope] || scope;
}

export function getCategoryIcon(category: string): string {
  return categoryIcons[category] || '📝';
}
