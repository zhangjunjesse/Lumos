// LLM 提示词里「一行一条」清单字段的安全渲染:折叠空白 + 截断 + JSON 转义。
// 用户填的名称/描述/SOP 常带换行和引号,不处理会把清单撑散,让模型读错条目边界。

/** 清单字段默认最大长度(超出截断并补省略号)。 */
export const PROMPT_FIELD_MAX = 160;

export function quotePromptField(raw: string, max: number = PROMPT_FIELD_MAX): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const truncated = collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
  return JSON.stringify(truncated);
}
