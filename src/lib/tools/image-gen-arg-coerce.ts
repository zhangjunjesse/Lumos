// generate_image 工具数组参数的容错归一化(纯函数,无依赖,便于单测)。
// MCP/模型常把数组参数序列化成字符串(整串 JSON / 单值 / 逗号分隔),严格 z.array 会拒收 → 创作助手空转重试。

export function coerceStringArray(v: unknown): unknown {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return undefined;
    if (s.startsWith('[')) {
      try {
        const p = JSON.parse(s);
        if (Array.isArray(p)) return p;
      } catch {
        /* 不是合法 JSON 数组,按下面分隔处理 */
      }
    }
    return s.includes(',') ? s.split(',').map((x) => x.trim()).filter(Boolean) : [s];
  }
  return v;
}

export function coerceJsonArray(v: unknown): unknown {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return undefined;
    try {
      const p = JSON.parse(s);
      if (Array.isArray(p)) return p;
    } catch {
      /* 解析失败交给内层 schema 报错 */
    }
  }
  return v;
}
