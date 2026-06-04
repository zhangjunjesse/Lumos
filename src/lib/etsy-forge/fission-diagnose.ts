// 裂变·诊断(playbook remix_direction_library 第2/5节):看这张印花,产出
//   强项(能卖的核心,不能动) / 80分综合征(最拖后腿的 1-2 点) / 从「当前方向库」里命中的建议方向 code。
// 红线:AI 只能从传入的库里选 code,不得发明库外方向;不伪造。诊断失败如实报,不阻断(用户仍可自己翻库选)。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { loadImageAsBase64 } from './image-fetch';
import { visionChat } from './vision-chat';
import { resolveVisionEndpoint } from './vision-provider';
import { listDirections } from './remix-directions';
import { COLLECTIONS, type FissionDiagnosisRow } from './types';

const DIAGNOSE_TIMEOUT_MS = 90_000;
const DIAGNOSE_MAX_TOKENS = 2800; // 给足余量:gemini 先吐思考 token + 可能啰嗦,太小会在 JSON 没收尾就截断 → 匹配不到 "}"

export interface FissionDiagnosis {
  ok: boolean;
  strengths: string; // 强项(不能动)
  weaknesses: string[]; // 80 分综合征(1-2)
  recommendCodes: string[]; // 命中库中的方向 code(已过滤为库内有效)
  note: string;
  error?: string;
}

function buildPrompt(lib: { code: string; label: string; hint: string }[]): string {
  const menu = lib.map((d) => `${d.code}: ${d.label} — ${d.hint}`).join('\n');
  return [
    'You are an Etsy t-shirt print-design doctor. Look at this print and diagnose how to improve it for selling.',
    'You MUST choose recommended directions ONLY from the library below — never invent a direction outside it.',
    '--- DIRECTION LIBRARY (pick recommend codes from here) ---',
    menu,
    '--- END LIBRARY ---',
    'Keep EVERY value SHORT (no long explanations): strengths ≤ 15 words; each weakness ≤ 12 words; note ≤ 12 words.',
    'Return STRICT JSON ONLY (no markdown, no code fence): {"strengths":"the core selling point that must NOT be changed","weaknesses":["1-2 short phrases of the biggest problems"],"recommend":["2-4 direction codes from the library that best fix the weaknesses, e.g. A1, B2"],"note":"one short sentence"}',
  ].join('\n');
}

// 读缓存:同图诊断过就存了,直接返回(不调 vision)。
function readCache(store: AppDataStore, userId: string, baseAssetId: string): FissionDiagnosis | null {
  if (!baseAssetId) return null;
  const row = store.query<FissionDiagnosisRow>(COLLECTIONS.FISSION_DIAGNOSES, { filter: { user_id: userId, base_asset_id: baseAssetId }, limit: 1 })[0];
  if (!row) return null;
  return {
    ok: true,
    strengths: row.strengths || '',
    weaknesses: Array.isArray(row.weaknesses) ? row.weaknesses : [],
    recommendCodes: Array.isArray(row.recommend) ? row.recommend : [],
    note: row.note || '',
  };
}

function writeCache(store: AppDataStore, userId: string, baseAssetId: string, d: FissionDiagnosis): void {
  if (!baseAssetId) return;
  const old = store.query<FissionDiagnosisRow>(COLLECTIONS.FISSION_DIAGNOSES, { filter: { user_id: userId, base_asset_id: baseAssetId }, limit: 10 });
  for (const o of old) store.delete(COLLECTIONS.FISSION_DIAGNOSES, o.id);
  store.create(COLLECTIONS.FISSION_DIAGNOSES, {
    user_id: userId,
    base_asset_id: baseAssetId,
    strengths: d.strengths,
    weaknesses: d.weaknesses,
    recommend: d.recommendCodes,
    note: d.note,
    created_at: new Date().toISOString(),
  });
}

// baseAssetId:发起裂变的那张图素材 id,用于缓存;force=true 时强制重诊断(用户点「重新诊断」)。
export async function diagnoseForFission(store: AppDataStore, userId: string, baseRef: string, baseAssetId = '', force = false): Promise<FissionDiagnosis> {
  const empty: FissionDiagnosis = { ok: false, strengths: '', weaknesses: [], recommendCodes: [], note: '' };
  if (!force) {
    const cached = readCache(store, userId, baseAssetId);
    if (cached) return { ...cached, note: cached.note || '(已缓存的诊断)' };
  }
  const vision = resolveVisionEndpoint(store);
  if (!vision.ok) return { ...empty, error: vision.error };

  const lib = listDirections(store, userId).filter((d) => d.enabled);
  const validCodes = new Set(lib.map((d) => d.code));

  let img;
  try {
    const localPath = baseRef.startsWith('/api/media/serve') ? new URL(baseRef, 'http://localhost').searchParams.get('path') || undefined : undefined;
    img = await loadImageAsBase64({ localPath, url: baseRef });
  } catch (err) {
    return { ...empty, error: `读取图片失败:${err instanceof Error ? err.message : String(err)}` };
  }

  try {
    const content = await visionChat(vision.ep, img, buildPrompt(lib.map((d) => ({ code: d.code, label: d.label, hint: d.hint }))), DIAGNOSE_MAX_TOKENS, DIAGNOSE_TIMEOUT_MS);
    const m = content.match(/\{[\s\S]*\}/);
    // 解析不到 JSON 时把模型实际返回的开头带出来,方便定位是"空返回"还是"返回了大白话"。
    if (!m) throw new Error(`诊断未返回 JSON。模型实际返回:${content.trim().slice(0, 200) || '(空)'}`);
    const j = JSON.parse(m[0]) as { strengths?: unknown; weaknesses?: unknown; recommend?: unknown; note?: unknown };
    const S = (v: unknown) => (v == null ? '' : String(v).trim());
    const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => S(x)).filter(Boolean) : []);
    const recommend = arr(j.recommend)
      .map((c) => c.toUpperCase().replace(/[^A-Z0-9]/g, '')) // 容忍 "A1." / "a1"
      .filter((c) => validCodes.has(c)); // 红线:只保留库内有效 code
    const result: FissionDiagnosis = {
      ok: true,
      strengths: S(j.strengths),
      weaknesses: arr(j.weaknesses).slice(0, 2),
      recommendCodes: recommend,
      note: S(j.note),
    };
    writeCache(store, userId, baseAssetId, result); // 存缓存,下次同图直接用
    return result;
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}
