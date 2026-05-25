/**
 * X 雷达报告图片：markdown 解析 + block 渲染。
 * 拆出来让 report-image-styles.ts 保持在 300 行内。
 */

import React from 'react';
import type { Theme } from './report-image-styles';

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'list'; text: string; ordered?: boolean; index?: number }
  | { kind: 'quote'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'hr' }
  | { kind: 'blank' };

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let olIndex = 0;
  for (const raw of lines) {
    if (inCode) {
      if (/^```/.test(raw)) { blocks.push({ kind: 'code', text: codeBuf.join('\n') }); codeBuf = []; inCode = false; }
      else codeBuf.push(raw);
      continue;
    }
    const line = raw.trimEnd();
    if (/^```/.test(line)) { inCode = true; continue; }
    if (line === '') { blocks.push({ kind: 'blank' }); olIndex = 0; continue; }
    if (/^---+$/.test(line)) { blocks.push({ kind: 'hr' }); continue; }
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) { blocks.push({ kind: 'heading', level: 3, text: stripInline(h3[1]) }); olIndex = 0; continue; }
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) { blocks.push({ kind: 'heading', level: 2, text: stripInline(h2[1]) }); olIndex = 0; continue; }
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) { blocks.push({ kind: 'heading', level: 1, text: stripInline(h1[1]) }); olIndex = 0; continue; }
    const quote = /^>\s+(.+)$/.exec(line);
    if (quote) { blocks.push({ kind: 'quote', text: stripInline(quote[1]) }); continue; }
    const ol = /^\d+\.\s+(.+)$/.exec(line);
    if (ol) { olIndex += 1; blocks.push({ kind: 'list', text: stripInline(ol[1]), ordered: true, index: olIndex }); continue; }
    const ul = /^[-*]\s+(.+)$/.exec(line);
    if (ul) { blocks.push({ kind: 'list', text: stripInline(ul[1]) }); olIndex = 0; continue; }
    blocks.push({ kind: 'para', text: stripInline(line) });
    olIndex = 0;
  }
  if (inCode && codeBuf.length > 0) blocks.push({ kind: 'code', text: codeBuf.join('\n') });
  return blocks;
}

function stripInline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}

export function estimateBlockHeight(block: Block, charsPerLine: number): number {
  // 高度估算单位放大 2.5x（base 字号 18 → 40）
  if (block.kind === 'blank') return 36;
  if (block.kind === 'hr') return 72;
  if (block.kind === 'heading') {
    const h = { 1: 140, 2: 110, 3: 80 };
    const lines = Math.ceil(block.text.length / charsPerLine);
    const spacing = block.level === 1 ? 72 : block.level === 2 ? 108 : 64;
    return h[block.level] * lines + spacing;
  }
  if (block.kind === 'list') {
    const lines = Math.ceil(block.text.length / charsPerLine) || 1;
    return 80 * lines + 20;
  }
  if (block.kind === 'quote') {
    const lines = Math.ceil(block.text.length / charsPerLine) || 1;
    return 80 * lines + 54;
  }
  if (block.kind === 'code') {
    const lines = block.text.split('\n').length;
    return 58 * lines + 80;
  }
  const lines = Math.ceil(block.text.length / charsPerLine) || 1;
  return 80 * lines + 32;
}

export function renderBlock(block: Block, theme: Theme, idx: number, all: Block[]): React.ReactElement {
  const key = `b-${idx}`;
  if (block.kind === 'blank') return React.createElement('div', { key, style: { height: 8 } });
  if (block.kind === 'hr') return React.createElement('div', {
    key, style: { height: 1, backgroundColor: theme.divider, marginTop: 16, marginBottom: 16 },
  });
  if (block.kind === 'heading') return renderHeading(block, theme, key);
  if (block.kind === 'list') return renderList(block, theme, key);
  if (block.kind === 'quote') return renderQuote(block, theme, key);
  if (block.kind === 'code') return renderCode(block, theme, key);
  const prev = all[idx - 1];
  const isAfterHeading = prev?.kind === 'heading';
  return React.createElement('div', {
    key,
    style: {
      fontSize: 40, color: theme.fg, lineHeight: 1.85,
      marginTop: isAfterHeading ? 10 : 32, marginBottom: 10,
    },
  }, block.text);
}

function renderHeading(block: Extract<Block, { kind: 'heading' }>, theme: Theme, key: string): React.ReactElement {
  if (block.level === 1) {
    return React.createElement('div', {
      key,
      style: {
        fontSize: 72, fontWeight: 700, color: theme.h1Color, lineHeight: 1.3,
        marginTop: 80, marginBottom: 36,
      },
    }, block.text);
  }
  if (block.level === 2) {
    return React.createElement('div', {
      key,
      style: { display: 'flex', flexDirection: 'column', marginTop: 88, marginBottom: 36 },
    }, [
      React.createElement('div', {
        key: 't',
        style: {
          display: 'flex', flexDirection: 'row', alignItems: 'center',
          fontSize: 60, fontWeight: 700, color: theme.h2Color, lineHeight: 1.25,
        },
      }, [
        React.createElement('div', {
          key: 'b',
          style: { width: 12, height: 60, marginRight: 32, borderRadius: 6, backgroundColor: theme.accent },
        }),
        block.text,
      ]),
      React.createElement('div', {
        key: 'line', style: { height: 2, backgroundColor: theme.divider, marginTop: 26 },
      }),
    ]);
  }
  return React.createElement('div', {
    key,
    style: {
      fontSize: 48, fontWeight: 600, color: theme.h3Color, lineHeight: 1.35,
      marginTop: 54, marginBottom: 22,
    },
  }, block.text);
}

function renderList(block: Extract<Block, { kind: 'list' }>, theme: Theme, key: string): React.ReactElement {
  const marker = block.ordered
    ? React.createElement('div', {
        key: 'm',
        style: { color: theme.accent, fontWeight: 700, fontSize: 40, minWidth: 64, marginRight: 16 },
      }, `${block.index}.`)
    : React.createElement('div', {
        key: 'm',
        style: { color: theme.accent, fontWeight: 700, fontSize: 48, minWidth: 48, marginRight: 16, lineHeight: 1 },
      }, '•');
  return React.createElement('div', {
    key,
    style: {
      display: 'flex', flexDirection: 'row', alignItems: 'flex-start',
      fontSize: 40, color: theme.fg, lineHeight: 1.85, marginBottom: 16,
    },
  }, [marker, React.createElement('div', { key: 't', style: { flex: 1 } }, block.text)]);
}

function renderQuote(block: Extract<Block, { kind: 'quote' }>, theme: Theme, key: string): React.ReactElement {
  return React.createElement('div', {
    key,
    style: { display: 'flex', flexDirection: 'row', marginTop: 20, marginBottom: 20, paddingTop: 8, paddingBottom: 8 },
  }, [
    React.createElement('div', {
      key: 'b', style: { width: 8, backgroundColor: theme.accent, borderRadius: 4, marginRight: 36 },
    }),
    React.createElement('div', {
      key: 't', style: { flex: 1, color: theme.muted, fontStyle: 'italic', fontSize: 38, lineHeight: 1.8 },
    }, block.text),
  ]);
}

function renderCode(block: Extract<Block, { kind: 'code' }>, theme: Theme, key: string): React.ReactElement {
  return React.createElement('div', {
    key,
    style: {
      backgroundColor: theme.codeBg, color: theme.codeText,
      padding: 36, marginTop: 28, marginBottom: 28, borderRadius: 16,
      fontSize: 32, lineHeight: 1.6,
      fontFamily: theme.fontFamily,
      border: `2px solid ${theme.divider}`,
    },
  }, block.text);
}

export function renderHeader(input: {
  title: string; subtitle?: string; metaLines?: string[];
}, theme: Theme): React.ReactElement {
  return React.createElement('div', {
    key: '__header',
    style: { display: 'flex', flexDirection: 'column', marginBottom: 80 },
  }, [
    React.createElement('div', {
      key: 'brand',
      style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 44 },
    }, [
      React.createElement('div', {
        key: 'd', style: { width: 18, height: 18, borderRadius: 9, marginRight: 22, backgroundColor: theme.accent },
      }),
      React.createElement('div', {
        key: 'l',
        style: { color: theme.brandLabel, fontSize: 30, fontWeight: 700, letterSpacing: 6 },
      }, 'X RADAR REPORT'),
    ]),
    React.createElement('div', {
      key: 'title',
      style: { fontSize: 96, fontWeight: 800, color: theme.h1Color, lineHeight: 1.2, marginBottom: 32 },
    }, input.title),
    input.subtitle
      ? React.createElement('div', {
          key: 'sub',
          style: { fontSize: 42, color: theme.muted, lineHeight: 1.4, marginBottom: 44 },
        }, input.subtitle)
      : null,
    (input.metaLines && input.metaLines.length > 0)
      ? React.createElement('div', {
          key: 'meta',
          style: {
            display: 'flex', flexDirection: 'column',
            paddingTop: 36, borderTop: `2px solid ${theme.divider}`,
          },
        }, input.metaLines.map((line, idx) =>
          React.createElement('div', {
            key: `m-${idx}`, style: { fontSize: 30, color: theme.muted, marginBottom: 12 },
          }, line),
        ))
      : null,
  ].filter(Boolean));
}

export function renderFooter(theme: Theme): React.ReactElement {
  return React.createElement('div', {
    key: '__footer',
    style: {
      display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginTop: 96, paddingTop: 44,
      borderTop: `2px solid ${theme.divider}`,
      fontSize: 28, color: theme.muted,
    },
  }, [
    React.createElement('div', {
      key: 'l',
      style: { display: 'flex', flexDirection: 'row', alignItems: 'center' },
    }, [
      React.createElement('div', {
        key: 'd', style: { width: 14, height: 14, borderRadius: 7, marginRight: 18, backgroundColor: theme.accent },
      }),
      React.createElement('div', { key: 't' }, 'Lumos · X 雷达 · 纯读 X 工作台'),
    ]),
    React.createElement('div', { key: 'r' }, new Date().toLocaleString('zh-CN')),
  ]);
}
