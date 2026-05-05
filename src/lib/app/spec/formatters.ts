// Human-readable formatters: spec → DSL string for AI context, errors → AI feedback.

import type {
  AppSpec, CompileIssue, FieldSpec, ListPage, FormPage, DetailPage,
  SinglePage, ResultPage,
} from './types';

export function summarizeSpecForAi(spec: AppSpec | null): string {
  if (!spec) return '（当前还没有应用 spec，需要从 update_app_spec 开始建立。）';
  const lines: string[] = [];
  lines.push('app:');
  lines.push(`  name: ${spec.app.name}`);
  if (spec.app.description) lines.push(`  description: ${spec.app.description}`);
  if (spec.app.category) lines.push(`  category: ${spec.app.category}`);
  if (spec.app.needs?.length) lines.push(`  needs: [${spec.app.needs.join(', ')}]`);

  if (spec.menu?.length) {
    lines.push('menu:');
    for (const m of spec.menu) {
      const id = typeof m === 'string' ? m : m.id;
      lines.push(`  - ${id}`);
    }
    if (spec.default) lines.push(`  default: ${spec.default}`);
  }

  if (spec.data && Object.keys(spec.data).length > 0) {
    lines.push('data:');
    for (const [name, col] of Object.entries(spec.data)) {
      lines.push(`  ${name}:${col.label ? ` # ${col.label}` : ''}`);
      lines.push('    fields:');
      for (const [fname, fraw] of Object.entries(col.fields)) {
        if (typeof fraw === 'string') {
          lines.push(`      ${fname}: ${fraw}`);
        } else {
          lines.push(`      ${fname}: ${formatFieldSpec(fraw as FieldSpec)}`);
        }
      }
    }
  }

  if (spec.pages && Object.keys(spec.pages).length > 0) {
    lines.push('pages:');
    for (const [pid, page] of Object.entries(spec.pages)) {
      lines.push(`  ${pid}: # ${page.title} (${page.layout})`);
      switch (page.layout) {
        case 'list': {
          const p = page as ListPage;
          lines.push(`    layout: list`);
          lines.push(`    data: ${p.data}`);
          if (p.columns?.length) {
            lines.push(`    columns: [${p.columns.map((c) => (typeof c === 'string' ? c : c.field)).join(', ')}]`);
          }
          if (p.search?.length) lines.push(`    search: [${p.search.join(', ')}]`);
          if (p.filter?.length) lines.push(`    filter: [${p.filter.join(', ')}]`);
          break;
        }
        case 'form': {
          const p = page as FormPage;
          lines.push(`    layout: form`);
          lines.push(`    collection: ${p.collection}`);
          if (p.fields?.length) {
            lines.push(`    fields: [${p.fields.map((f) => (typeof f === 'string' ? f : f.field)).join(', ')}]`);
          }
          break;
        }
        case 'detail': {
          const p = page as DetailPage;
          lines.push(`    layout: detail`);
          lines.push(`    collection: ${p.collection}`);
          if (p.tabs?.length) {
            lines.push(`    tabs: [${p.tabs.map((t) => t.label).join(', ')}]`);
          }
          break;
        }
        case 'single': {
          const p = page as SinglePage;
          lines.push(`    layout: single`);
          lines.push(`    blocks: ${p.blocks.length} 个区块`);
          break;
        }
        case 'result': {
          const p = page as ResultPage;
          lines.push(`    layout: result`);
          lines.push(`    source: ${p.source}`);
          lines.push(`    render: ${p.render}`);
          break;
        }
      }
    }
  }

  if (spec.workflows && Object.keys(spec.workflows).length > 0) {
    lines.push('workflows:');
    for (const [wid] of Object.entries(spec.workflows)) {
      lines.push(`  ${wid}`);
    }
  }

  if (spec.seed && Object.keys(spec.seed).length > 0) {
    lines.push('seed:');
    for (const [col, rows] of Object.entries(spec.seed)) {
      lines.push(`  ${col}: ${rows.length} 行`);
    }
  }

  return lines.join('\n');
}

function formatFieldSpec(spec: FieldSpec): string {
  const parts: string[] = [];
  if (spec.type === 'enum' && spec.options) {
    parts.push(`enum[${spec.options.join('|')}]`);
  } else if (spec.type === 'ref' && spec.ref) {
    parts.push(`ref(${spec.ref})`);
  } else {
    parts.push(spec.type);
  }
  if (spec.required) parts.push('required');
  if (spec.unique) parts.push('unique');
  if (spec.indexed) parts.push('indexed');
  if (spec.label) parts.push(`label="${spec.label}"`);
  if (spec.default !== undefined) parts.push(`default=${spec.default}`);
  return parts.join(' ');
}

export function formatCompileFeedback(
  errors: CompileIssue[],
  warnings: CompileIssue[],
): string {
  const lines: string[] = [];
  if (errors.length > 0) {
    lines.push(`❌ 编译失败，${errors.length} 个错误必须修复：`);
    errors.forEach((e, i) => {
      const where = e.loc?.line ? `第 ${e.loc.line} 行` : (e.loc?.path?.length ? e.loc.path.join('.') : '');
      lines.push(`  ${i + 1}. ${where ? `[${where}] ` : ''}${e.message}`);
      if (e.suggestion) lines.push(`     建议：${e.suggestion}`);
    });
  } else {
    lines.push('✅ 编译成功');
  }
  if (warnings.length > 0) {
    lines.push('');
    lines.push(`⚠ ${warnings.length} 个警告（compiler 已自动处理，无需 AI 介入）：`);
    warnings.forEach((w, i) => {
      const where = w.loc?.line ? `第 ${w.loc.line} 行` : (w.loc?.path?.length ? w.loc.path.join('.') : '');
      lines.push(`  ${i + 1}. ${where ? `[${where}] ` : ''}${w.message}`);
    });
  }
  return lines.join('\n');
}
