// T恤模板管理:内置模板按需 seed(底图从应用资源拷进媒体目录,运行时不依赖包内路径),
// 用户可上传底图+框选印花区。一键出品第⑧步按「启用的模板 × 印花」程序合成。

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS, type MockupTemplateRow } from './types';
import type { PrintArea } from '@/lib/image/compose';

const nowIso = () => new Date().toISOString();

// 内置模板声明:底图在应用包 assets 里,print_area 是 2048×2048 底图像素系的前胸印花区。
const BUILTIN_TEMPLATES: Array<{ key: string; name: string; file: string; printArea: PrintArea }> = [
  { key: 'builtin-white-front', name: '白色T恤·正面', file: 'white-front.png', printArea: { x: 660, y: 500, w: 730, h: 880 } },
  { key: 'builtin-black-front', name: '黑色T恤·正面', file: 'black-front.png', printArea: { x: 660, y: 500, w: 730, h: 880 } },
];

function builtinAssetDir(): string {
  // 开发 cwd=仓库根;生产 cwd=standalone(electron 主进程 spawn 约定,apps/ 随包分发)。
  return path.join(process.cwd(), 'apps', 'etsy-forge', 'assets', 'mockup-templates');
}

function mediaDir(): string {
  const base = process.env.LUMOS_DATA_DIR || path.join(process.env.HOME || '', '.lumos');
  const dir = path.join(base, '.lumos-media', 'mockup-templates');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureBuiltinTemplates(store: AppDataStore, userId: string): void {
  const existing = store.query<MockupTemplateRow>(COLLECTIONS.MOCKUP_TEMPLATES, { filter: { user_id: userId }, limit: 1 });
  if (existing.length > 0) return;
  for (const t of BUILTIN_TEMPLATES) {
    const src = path.join(builtinAssetDir(), t.file);
    if (!fs.existsSync(src)) continue; // 包内资源缺失就不 seed(不造假模板),UI 会显示空列表
    const dest = path.join(mediaDir(), `${t.key}.png`);
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    store.create(COLLECTIONS.MOCKUP_TEMPLATES, {
      user_id: userId,
      name: t.name,
      base_path: dest,
      print_area: t.printArea,
      enabled: true,
      builtin: true,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }
}

export function listTemplates(store: AppDataStore, userId: string): MockupTemplateRow[] {
  ensureBuiltinTemplates(store, userId);
  return store.query<MockupTemplateRow>(COLLECTIONS.MOCKUP_TEMPLATES, {
    filter: { user_id: userId },
    orderBy: { field: 'created_at', direction: 'asc' },
    limit: 100,
  });
}

// 一键出品用:启用中的模板(底图文件还在的)。
export function listEnabledTemplates(store: AppDataStore, userId: string): MockupTemplateRow[] {
  return listTemplates(store, userId).filter((t) => t.enabled && !!t.base_path && fs.existsSync(t.base_path));
}

const MAX_BASE_IMAGE_BYTES = 20 * 1024 * 1024;

export async function createTemplate(
  store: AppDataStore,
  userId: string,
  input: { name: string; baseImageBase64: string; printArea?: PrintArea },
): Promise<MockupTemplateRow> {
  const name = input.name?.trim();
  if (!name) throw new Error('模板名不能为空');
  const buf = Buffer.from(input.baseImageBase64, 'base64');
  if (buf.length < 1024) throw new Error('底图无效(太小)');
  if (buf.length > MAX_BASE_IMAGE_BYTES) throw new Error('底图超过 20MB 上限');
  // 服务端真实解码探测:前端 accept 只是提示,直接打 API 可绕过;坏文件在这里报,别拖到出图流程深处。
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) throw new Error('no dimensions');
  } catch {
    throw new Error('底图不是可解码的图片文件');
  }
  const dest = path.join(mediaDir(), `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  fs.writeFileSync(dest, buf);
  const created = store.create(COLLECTIONS.MOCKUP_TEMPLATES, {
    user_id: userId,
    name,
    base_path: dest,
    print_area: sanitizePrintArea(input.printArea),
    enabled: true,
    builtin: false,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return created as unknown as MockupTemplateRow;
}

export function updateTemplate(
  store: AppDataStore,
  userId: string,
  id: string,
  patch: { name?: string; printArea?: PrintArea; enabled?: boolean },
): MockupTemplateRow {
  const row = store.get<MockupTemplateRow>(COLLECTIONS.MOCKUP_TEMPLATES, id);
  if (!row || row.user_id !== userId) throw new Error('模板不存在');
  const next: Partial<MockupTemplateRow> = { updated_at: nowIso() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('模板名不能为空');
    next.name = name;
  }
  if (patch.printArea !== undefined) next.print_area = sanitizePrintArea(patch.printArea);
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  store.update(COLLECTIONS.MOCKUP_TEMPLATES, id, next);
  const updated = store.get<MockupTemplateRow>(COLLECTIONS.MOCKUP_TEMPLATES, id);
  if (!updated) throw new Error('模板更新后读取失败');
  return updated;
}

export function deleteTemplate(store: AppDataStore, userId: string, id: string): void {
  const row = store.get<MockupTemplateRow>(COLLECTIONS.MOCKUP_TEMPLATES, id);
  if (!row || row.user_id !== userId) return;
  if (row.builtin) throw new Error('内置模板不可删,可在列表里停用');
  store.delete(COLLECTIONS.MOCKUP_TEMPLATES, id);
  // 底图是模板私有落盘文件,随模板删除(best-effort)
  try {
    if (row.base_path && fs.existsSync(row.base_path)) fs.unlinkSync(row.base_path);
  } catch { /* 文件占用等,不阻断删除 */ }
}

function sanitizePrintArea(area?: PrintArea): PrintArea {
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : d);
  return { x: n(area?.x, 660), y: n(area?.y, 500), w: Math.max(50, n(area?.w, 730)), h: Math.max(50, n(area?.h, 880)) };
}
