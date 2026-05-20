"use client";

// 进化建议/沉淀经验/沉淀 生成后，就地展示生成内容（不必跳走才能看）。

export type DigestActionKind = "improvement" | "experience" | "insight";

export interface ActionResult {
  tag: string;
  title: string;
  fields: { k: string; v: string }[];
}

const s = (v: unknown) => String(v ?? "").trim();

// candidate / entry 都是后端原始 snake_case 对象；统一转成展示用 ActionResult。
export function toActionResult(
  action: DigestActionKind,
  data: { candidate?: Record<string, unknown> | null; entry?: Record<string, unknown> | null },
): ActionResult | null {
  if (action === "improvement" && data.candidate) {
    const c = data.candidate;
    return {
      tag: "进化建议 · 已存入「行动记忆 · 自我改进」",
      title: s(c.title) || "(无标题)",
      fields: [
        { k: "类型", v: s(c.candidate_type) },
        { k: "风险", v: s(c.risk_level) },
        { k: "问题", v: s(c.problem) },
        { k: "建议方案", v: s(c.proposed_capability) },
      ],
    };
  }
  if (data.entry) {
    const e = data.entry;
    return {
      tag: action === "experience" ? "经验 · 已存入复盘账" : "已沉淀到行动记忆",
      title: s(e.title) || "(无标题)",
      fields: [
        { k: "类型", v: s(e.kind) },
        { k: "内容", v: s(e.body) },
      ],
    };
  }
  return null;
}

export function DigestActionResult({ result }: { result: ActionResult }) {
  return (
    <div className="rounded-md border border-sky-200 bg-sky-50/60 p-3 text-xs leading-6">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="rounded border border-sky-200 bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-700">
          {result.tag}
        </span>
        <span className="font-medium text-foreground">{result.title}</span>
      </div>
      <dl className="space-y-0.5">
        {result.fields.map((f, i) => (
          <div key={i} className="flex gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">{f.k}</dt>
            <dd className="flex-1 break-words text-foreground">{f.v || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
