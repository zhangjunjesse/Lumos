/**
 * X 雷达报告 → docx 渲染。微信收到 docx 能直接预览/打开。
 *
 * 不用 pdf-lib —— 默认 StandardFonts 不支持中文，要装 @pdf-lib/fontkit + 嵌入 5MB+ 中文 ttf。
 * docx 用 Word/微信预览自带的系统字体，零外部依赖。
 *
 * 支持的 markdown 子集：
 *   # / ## / ### 标题
 *   - / * 列表
 *   **加粗** / *斜体* / `行内代码`
 *   [文字](URL) 链接（链接内可嵌 **加粗** / *斜体*；不嵌套链接）
 *   ``` 块级代码块（跨行）
 *   空行 = 段
 */

import { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink } from 'docx';

export interface ReportDocxInput {
  title: string;
  subtitle?: string;
  metaLines?: string[];
  markdown: string;
}

export async function renderReportDocx(input: ReportDocxInput): Promise<Buffer> {
  const paragraphs: Paragraph[] = [];

  if (input.title.trim()) {
    paragraphs.push(new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: input.title, bold: true, size: 36 })],
    }));
  }
  if (input.subtitle) {
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text: input.subtitle, italics: true, size: 22, color: '666666' })],
    }));
  }
  for (const line of input.metaLines ?? []) {
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text: line, size: 18, color: '888888' })],
    }));
  }
  if ((input.metaLines && input.metaLines.length > 0) || input.subtitle) {
    paragraphs.push(new Paragraph({}));
  }

  for (const block of parseMarkdown(input.markdown)) {
    paragraphs.push(blockToParagraph(block));
  }

  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

// === markdown 块级解析 ===

interface RunStyle { bold?: boolean; italics?: boolean; monospace?: boolean; }
type RunSpec =
  | ({ kind: 'run'; text: string } & RunStyle)
  | { kind: 'link'; url: string; children: ({ text: string } & RunStyle)[] };

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; spans: RunSpec[] }
  | { kind: 'list'; spans: RunSpec[] }
  | { kind: 'para'; spans: RunSpec[] }
  | { kind: 'code'; text: string }
  | { kind: 'blank' };

function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  for (const raw of lines) {
    if (inCode) {
      if (/^```/.test(raw)) {
        blocks.push({ kind: 'code', text: codeBuf.join('\n') });
        codeBuf = []; inCode = false;
      } else {
        codeBuf.push(raw);
      }
      continue;
    }
    const line = raw.trimEnd();
    if (/^```/.test(line)) { inCode = true; continue; }
    if (line === '') { blocks.push({ kind: 'blank' }); continue; }
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) { blocks.push({ kind: 'heading', level: 3, spans: parseInline(h3[1]) }); continue; }
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) { blocks.push({ kind: 'heading', level: 2, spans: parseInline(h2[1]) }); continue; }
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) { blocks.push({ kind: 'heading', level: 1, spans: parseInline(h1[1]) }); continue; }
    const li = /^[-*]\s+(.+)$/.exec(line);
    if (li) { blocks.push({ kind: 'list', spans: parseInline(li[1]) }); continue; }
    blocks.push({ kind: 'para', spans: parseInline(line) });
  }
  // 遗留没闭合的代码块也要 flush（容错）
  if (inCode && codeBuf.length > 0) blocks.push({ kind: 'code', text: codeBuf.join('\n') });
  return blocks;
}

// === 行内解析（支持嵌套）===

/**
 * 解析 **加粗** 和 [文字](url)，**支持任意嵌套**：
 *   **[a](u)** → link, link 内 child bold
 *   [**a** b](u) → link, 子 run [bold a][regular  b]
 *   **regular [link](u) end** → bold run + bold link + bold run
 * 链接内不能再嵌链接（罕见且 markdown 规范不支持）。
 */
function parseInline(text: string): RunSpec[] {
  return tokenize(text, { style: {}, allowLink: true });
}

interface ParseOpts { style: RunStyle; allowLink: boolean; }

function tokenize(text: string, opts: ParseOpts): RunSpec[] {
  const out: RunSpec[] = [];
  let i = 0;
  let buf = '';
  const flushBuf = () => {
    if (buf) { out.push({ kind: 'run', text: buf, ...opts.style }); buf = ''; }
  };
  while (i < text.length) {
    // ** 加粗（优先于 * 斜体）
    if (text.startsWith('**', i)) {
      const close = text.indexOf('**', i + 2);
      if (close >= 0) {
        flushBuf();
        for (const child of tokenize(text.slice(i + 2, close), {
          style: { ...opts.style, bold: !opts.style.bold }, allowLink: opts.allowLink,
        })) out.push(child);
        i = close + 2; continue;
      }
    }
    // * 斜体（确保不是 **）；_斜体_ 同处理
    if ((text[i] === '*' && text[i + 1] !== '*') || text[i] === '_') {
      const marker = text[i];
      const close = text.indexOf(marker, i + 1);
      if (close > i + 1 && close < text.length) {
        flushBuf();
        for (const child of tokenize(text.slice(i + 1, close), {
          style: { ...opts.style, italics: !opts.style.italics }, allowLink: opts.allowLink,
        })) out.push(child);
        i = close + 1; continue;
      }
    }
    // ` 行内代码（不递归 — 内部当字面字符）
    if (text[i] === '`') {
      const close = text.indexOf('`', i + 1);
      if (close > i + 1) {
        flushBuf();
        out.push({ kind: 'run', text: text.slice(i + 1, close), monospace: true, ...opts.style });
        i = close + 1; continue;
      }
    }
    // [文字](url) 链接
    if (opts.allowLink && text[i] === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      if (closeBracket > 0 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen > 0) {
          flushBuf();
          const linkText = text.slice(i + 1, closeBracket);
          const url = text.slice(closeBracket + 2, closeParen);
          const innerRuns = tokenize(linkText, { style: opts.style, allowLink: false });
          const children = innerRuns
            .filter((r): r is { kind: 'run'; text: string } & RunStyle => r.kind === 'run')
            .map((r) => ({ text: r.text, bold: r.bold, italics: r.italics, monospace: r.monospace }));
          out.push({
            kind: 'link', url,
            children: children.length > 0 ? children : [{ text: linkText, ...opts.style }],
          });
          i = closeParen + 1; continue;
        }
      }
    }
    buf += text[i];
    i += 1;
  }
  flushBuf();
  return out;
}

// === 渲染 ===

function blockToParagraph(block: Block): Paragraph {
  if (block.kind === 'blank') return new Paragraph({});
  if (block.kind === 'code') {
    // 代码块整段渲染为 monospace + 浅灰背景的段落（用 shading）
    return new Paragraph({
      shading: { type: 'clear', color: 'auto', fill: 'F5F5F5' },
      children: [new TextRun({ text: block.text, font: 'Courier New', size: 20 })],
    });
  }
  const children = block.spans.map(specToRun);
  if (block.kind === 'heading') {
    return new Paragraph({
      heading: block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
      children,
    });
  }
  if (block.kind === 'list') {
    return new Paragraph({ bullet: { level: 0 }, children });
  }
  return new Paragraph({ children });
}

function specToRun(spec: RunSpec): TextRun | ExternalHyperlink {
  if (spec.kind === 'link') {
    return new ExternalHyperlink({
      link: spec.url,
      children: spec.children.map((c) => new TextRun({
        text: c.text, bold: c.bold, italics: c.italics,
        font: c.monospace ? 'Courier New' : undefined,
        color: '0563C1', underline: {},
      })),
    });
  }
  return new TextRun({
    text: spec.text, bold: spec.bold, italics: spec.italics,
    font: spec.monospace ? 'Courier New' : undefined,
  });
}
