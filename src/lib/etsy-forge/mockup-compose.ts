// 模板合成的单张执行与重试:execMockup(一键出品第⑧步)与重试路由共用,
// 成败都落 mockups 表(重试=覆盖原行),失败原因如实记录。零 LLM。

import fs from 'fs';
import path from 'path';
import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { composePrintOnBase, stripBackground } from '@/lib/image/compose';
import { COLLECTIONS, type MockupRow, type MockupTemplateRow } from './types';
import { listTemplates } from './mockup-templates';

const nowIso = () => new Date().toISOString();

function mediaDir(): string {
  return path.join(process.env.LUMOS_DATA_DIR || path.join(process.env.HOME || '', '.lumos'), '.lumos-media');
}

// 单张:把预处理好的印花合成到模板,写(或覆盖)一行 mockups。返回是否成功。
export async function composeMockupRecord(
  store: AppDataStore,
  userId: string,
  opts: {
    print: Buffer;
    template: MockupTemplateRow;
    designRef: string;
    sourceProductId?: string;
    existingId?: string; // 重试:覆盖这行而不是新建
  },
): Promise<boolean> {
  const base: Partial<MockupRow> = {
    user_id: userId,
    design_label: '二创',
    design_ref: opts.designRef,
    source_product_id: opts.sourceProductId,
    template_id: opts.template.id,
  };
  const outPath = path.join(mediaDir(), `mockup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  try {
    await composePrintOnBase({ basePath: opts.template.base_path, print: opts.print, printArea: opts.template.print_area, outPath });
    upsert(store, opts.existingId, { ...base, image_path: outPath, status: 'success', failure_reason: '' });
    return true;
  } catch (err) {
    upsert(store, opts.existingId, { ...base, status: 'failed', failure_reason: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

// 重试一张模板合成的 mockup(路由 fire-and-forget 调用):重跑印花预处理+合成,覆盖原行。
// 不需要图片服务商——纯本地。前置缺失(印花文件没了/模板被删)如实写回失败原因。
export async function retryTemplateMockup(store: AppDataStore, userId: string, m: MockupRow): Promise<void> {
  const fail = (reason: string) =>
    store.update(COLLECTIONS.MOCKUPS, m.id, { status: 'failed', failure_reason: reason, updated_at: nowIso() });

  const designRef = m.design_ref || '';
  if (!designRef || !fs.existsSync(designRef)) {
    fail('印花源文件不存在,无法重新合成');
    return;
  }
  const template = listTemplates(store, userId).find((t) => t.id === m.template_id);
  if (!template) {
    fail('原T恤模板已删除,无法重新合成');
    return;
  }
  if (!fs.existsSync(template.base_path)) {
    fail('模板底图文件不存在,无法重新合成');
    return;
  }

  let print: Buffer;
  try {
    print = await stripBackground(designRef);
  } catch (err) {
    fail(`印花预处理失败:${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  await composeMockupRecord(store, userId, {
    print,
    template,
    designRef,
    sourceProductId: m.source_product_id,
    existingId: m.id,
  });
}

function upsert(store: AppDataStore, existingId: string | undefined, row: Partial<MockupRow>): void {
  if (existingId) {
    store.update(COLLECTIONS.MOCKUPS, existingId, { ...row, updated_at: nowIso() });
  } else {
    store.create(COLLECTIONS.MOCKUPS, { ...row, created_at: nowIso() });
  }
}
