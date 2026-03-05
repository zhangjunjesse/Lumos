/**
 * Markdown to Feishu Card JSON 2.0 converter
 */

import MarkdownIt from 'markdown-it';

export interface FeishuCard {
  schema: '2.0';
  config: {
    wide_screen_mode: boolean;
    enable_forward?: boolean;
  };
  header?: {
    template: string;
    title: { tag: string; content: string };
  };
  body: {
    elements: FeishuCardElement[];
  };
}

export interface FeishuCardElement {
  tag: string;
  [key: string]: any;
}

export interface ConvertOptions {
  title?: string;
  headerColor?: 'blue' | 'green' | 'yellow' | 'red' | 'grey';
  enableForward?: boolean;
}

const LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  yml: 'yaml',
  md: 'markdown',
};

function normalizeLanguage(lang?: string): string {
  if (!lang) return 'text';
  return LANGUAGE_MAP[lang.toLowerCase()] || lang;
}

export function markdownToFeishuCard(
  markdown: string,
  options: ConvertOptions = {}
): FeishuCard {
  const md = new MarkdownIt({ html: false, breaks: true });
  md.enable('table');
  const tokens = md.parse(markdown, {});
  const elements = tokensToElements(tokens);

  return {
    schema: '2.0',
    config: {
      wide_screen_mode: true,
      enable_forward: options.enableForward ?? true,
    },
    header: options.title
      ? {
          template: options.headerColor || 'blue',
          title: { tag: 'plain_text', content: options.title },
        }
      : undefined,
    body: { elements },
  };
}

function tokensToElements(tokens: any[]): FeishuCardElement[] {
  const elements: FeishuCardElement[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    switch (token.type) {
      case 'heading_open': {
        const level = parseInt(token.tag.slice(1));
        const contentToken = tokens[i + 1];
        if (contentToken?.type === 'inline') {
          elements.push({
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `${'#'.repeat(level)} ${renderInline(contentToken)}`,
            },
          });
        }
        i += 3;
        break;
      }

      case 'paragraph_open': {
        const contentToken = tokens[i + 1];
        if (contentToken?.type === 'inline') {
          const content = renderInline(contentToken);
          if (content.trim()) {
            elements.push({
              tag: 'div',
              text: { tag: 'lark_md', content },
            });
          }
        }
        i += 3;
        break;
      }

      case 'fence':
      case 'code_block': {
        elements.push({
          tag: 'code_block',
          language: normalizeLanguage(token.info),
          code: token.content || '',
        });
        i++;
        break;
      }

      case 'bullet_list_open':
      case 'ordered_list_open': {
        const listContent = extractList(tokens, i);
        if (listContent) {
          elements.push({
            tag: 'div',
            text: { tag: 'lark_md', content: listContent },
          });
        }
        i = skipList(tokens, i);
        break;
      }

      case 'hr':
        elements.push({ tag: 'hr' });
        i++;
        break;

      case 'blockquote_open': {
        const quoteContent = extractBlockquote(tokens, i);
        if (quoteContent) {
          elements.push({
            tag: 'note',
            elements: [{ tag: 'plain_text', content: quoteContent }],
          });
        }
        i = skipBlockquote(tokens, i);
        break;
      }

      case 'table_open': {
        const table = extractTable(tokens, i);
        if (table) {
          elements.push(table);
        }
        i = skipTable(tokens, i);
        break;
      }

      default:
        i++;
    }
  }

  return elements;
}

function renderInline(token: any): string {
  if (!token.children) return '';
  let result = '';
  for (const child of token.children) {
    switch (child.type) {
      case 'text':
        result += child.content;
        break;
      case 'code_inline':
        result += `\`${child.content}\``;
        break;
      case 'strong_open':
        result += '**';
        break;
      case 'strong_close':
        result += '**';
        break;
      case 'em_open':
        result += '*';
        break;
      case 'em_close':
        result += '*';
        break;
      case 'softbreak':
      case 'hardbreak':
        result += '\n';
        break;
    }
  }
  return result;
}

function extractList(tokens: any[], start: number): string {
  const isOrdered = tokens[start].type === 'ordered_list_open';
  let content = '';
  let itemIndex = 1;
  let i = start + 1;

  while (i < tokens.length && !tokens[i].type.includes('list_close')) {
    if (tokens[i].type === 'list_item_open') {
      const inlineToken = tokens[i + 2];
      if (inlineToken?.type === 'inline') {
        const prefix = isOrdered ? `${itemIndex}. ` : '- ';
        content += prefix + renderInline(inlineToken) + '\n';
        itemIndex++;
      }
    }
    i++;
  }
  return content.trim();
}

function skipList(tokens: any[], start: number): number {
  let depth = 1;
  let i = start + 1;
  while (i < tokens.length && depth > 0) {
    if (tokens[i].type.includes('list_open')) depth++;
    if (tokens[i].type.includes('list_close')) depth--;
    i++;
  }
  return i;
}

function extractBlockquote(tokens: any[], start: number): string {
  let content = '';
  let i = start + 1;
  while (i < tokens.length && tokens[i].type !== 'blockquote_close') {
    if (tokens[i].type === 'inline') {
      content += renderInline(tokens[i]) + '\n';
    }
    i++;
  }
  return content.trim();
}

function skipBlockquote(tokens: any[], start: number): number {
  let i = start + 1;
  while (i < tokens.length && tokens[i].type !== 'blockquote_close') {
    i++;
  }
  return i + 1;
}

function extractTable(tokens: any[], start: number): FeishuCardElement | null {
  const headers: string[] = [];
  const rows: string[][] = [];
  let i = start + 1;
  let inHeader = false;
  let currentRow: string[] = [];

  while (i < tokens.length && tokens[i].type !== 'table_close') {
    const token = tokens[i];
    if (token.type === 'thead_open') {
      inHeader = true;
    } else if (token.type === 'thead_close') {
      inHeader = false;
    } else if (token.type === 'tr_open') {
      currentRow = [];
    } else if (token.type === 'tr_close') {
      if (inHeader) {
        headers.push(...currentRow);
      } else {
        rows.push([...currentRow]);
      }
    } else if (token.type === 'inline') {
      currentRow.push(renderInline(token));
    }
    i++;
  }

  if (headers.length === 0) return null;

  return {
    tag: 'table',
    page_size: 10,
    row_height: 'middle',
    header_style: 'grey',
    columns: headers.map(h => ({
      name: h,
      width: 'auto',
      data_type: 'text',
    })),
    rows: rows.map(row => ({
      cells: row.map(cell => ({ text: cell })),
    })),
  };
}

function skipTable(tokens: any[], start: number): number {
  let i = start + 1;
  while (i < tokens.length && tokens[i].type !== 'table_close') {
    i++;
  }
  return i + 1;
}

export function splitCard(elements: FeishuCardElement[], maxSize = 10240): FeishuCardElement[][] {
  const chunks: FeishuCardElement[][] = [];
  let currentChunk: FeishuCardElement[] = [];
  let currentSize = 0;

  for (const element of elements) {
    const elementSize = JSON.stringify(element).length;
    if (currentChunk.length >= 50 || currentSize + elementSize > maxSize) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }
      currentChunk = [];
      currentSize = 0;
    }
    currentChunk.push(element);
    currentSize += elementSize;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
}
