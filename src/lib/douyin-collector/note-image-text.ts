// 图文里的图片取文字(#55)。
//
// 先本地 tesseract,不行再回退视觉模型 —— 但「不行」有三种,只认第一种会出事:
//   1. 命令不存在
//   2. 命令在,但缺中文语言包(chi_sim);装了 tesseract 却没装语言包很常见
//   3. **命令跑通了,结果是垃圾** ← 最危险
//
// 第 3 种是抖音图文的常态:艺术字、彩色背景、复杂排版,tesseract 在这类图上不报错,
// 直接吐乱码。这时候程序以为成功了,不会回退,垃圾文本一路进总结、进知识库 ——
// 比直接失败还糟,因为没人知道它坏了。
//
// 所以回退闸看的是**质量**,不是**有没有报错**。判据故意设得偏严:宁可多回退给
// 模型(模型是兜底,一定能出结果),OCR 只是想省钱 —— 省下来的东西得能用才算省。

import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { getDefaultProvider } from '@/lib/db/providers';
import { resolveProviderModelForRequest } from '@/lib/model-metadata';
import { providerSupportsCapability } from '@/lib/provider-config';
import { generateObjectFromProvider } from '@/lib/text-generator';

export type ImageTextSource = 'ocr' | 'model' | 'none';

export interface ImageTextResult {
  text: string;
  source: ImageTextSource;
  /** 没走 OCR 或从 OCR 掉下来的原因,便于在执行记录里看清发生了什么。 */
  reason?: string;
}

export interface OcrQualityVerdict {
  usable: boolean;
  reason?: string;
}

/** 识别结果至少要有这么多有效字符,否则当没认出来。 */
const MIN_USABLE_CHARS = 20;
/** 可疑字符(既不是汉字/字母/数字,也不是常见标点空白)的占比上限。 */
const MAX_SUSPICIOUS_RATIO = 0.25;
/** 碎片化判据:单字符行占比上限(行数够多时才作数)。 */
const MAX_SINGLE_CHAR_LINE_RATIO = 0.5;
const FRAGMENT_MIN_LINES = 5;

const COMMON_CHAR_RE = /[一-龥a-zA-Z0-9\s。，、；：？！""''（）《》〈〉—…·.,;:?!()[\]{}'"\-+/*%$#@&=_~`|\\<>]/;

/**
 * 判断 OCR 结果能不能用。
 *
 * 这道闸是双路径方案成立的前提 —— 没有它,「跑通但是垃圾」会被当成成功。
 */
export function judgeOcrQuality(raw: string): OcrQualityVerdict {
  const text = raw.trim();
  if (!text) return { usable: false, reason: 'OCR 没识别出任何文字' };

  const compact = text.replace(/\s/g, '');
  if (compact.length < MIN_USABLE_CHARS) {
    return { usable: false, reason: `OCR 只认出 ${compact.length} 个字符，太少` };
  }

  let suspicious = 0;
  for (const ch of compact) {
    if (!COMMON_CHAR_RE.test(ch)) suspicious += 1;
  }
  const ratio = suspicious / compact.length;
  if (ratio > MAX_SUSPICIOUS_RATIO) {
    return {
      usable: false,
      reason: `OCR 结果里 ${Math.round(ratio * 100)}% 是乱码字符，判定识别失败`,
    };
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length >= FRAGMENT_MIN_LINES) {
    const singles = lines.filter((l) => l.length === 1).length;
    if (singles / lines.length > MAX_SINGLE_CHAR_LINE_RATIO) {
      return { usable: false, reason: 'OCR 结果碎成了单字，排版没认出来' };
    }
  }

  return { usable: true };
}

interface RunResult {
  ok: boolean;
  stdout: string;
  error?: string;
}

function runTesseract(filePath: string, langs: string): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      'tesseract',
      [filePath, 'stdout', '-l', langs, '--oem', '1', '--psm', '6'],
      { timeout: 45_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          resolve({ ok: false, stdout: '', error: error.message });
          return;
        }
        resolve({ ok: true, stdout: typeof stdout === 'string' ? stdout : '' });
      },
    );
  });
}

/** 跑 OCR。命令缺失、缺语言包、结果是垃圾 —— 三种都算「不可用」。 */
export async function runOcr(filePath: string): Promise<ImageTextResult> {
  let attempt = await runTesseract(filePath, 'chi_sim+eng');
  if (!attempt.ok) {
    // 缺 chi_sim 时退英文再试一次;还不行就是命令本身有问题。
    attempt = await runTesseract(filePath, 'eng');
  }
  if (!attempt.ok) {
    return { text: '', source: 'none', reason: `tesseract 不可用：${attempt.error ?? '未知错误'}` };
  }

  const verdict = judgeOcrQuality(attempt.stdout);
  if (!verdict.usable) {
    return { text: '', source: 'none', reason: verdict.reason };
  }
  return { text: attempt.stdout.trim(), source: 'ocr' };
}

export async function downloadImage(url: string, targetDir: string, index: number): Promise<string> {
  const res = await fetch(url, {
    headers: { referer: 'https://www.douyin.com/', 'user-agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}：${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = path.extname(new URL(url).pathname) || '.jpg';
  const filePath = path.join(targetDir, `img-${index}${ext}`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function createImageWorkDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'lumos-douyin-note-'));
}

export async function cleanupImageWorkDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/** 一条图文最多读这么多张图 —— 挡住异常长图集把 token 烧穿。 */
export const MAX_NOTE_IMAGES = 12;

export interface NoteImageTextResult {
  text: string;
  /** 哪些图走了 OCR、哪些走了模型,便于在执行记录里看清成本从哪来。 */
  ocrCount: number;
  modelCount: number;
  /** 被跳过的图和原因。 */
  failures: string[];
  /** 超出上限被丢掉的图片数;不写出来就等于悄悄少采了内容。 */
  skippedForLimit: number;
}

/**
 * 把一条图文的图片读成文字。
 *
 * 逐张先试 OCR,过不了质量闸的**攒起来一起交给模型** —— 能本地认出来的不花钱,
 * 认不出的也不会退化成乱码。图文的图通常是同一套设计,所以往往要么全过要么全退,
 * 但按张判定不会因为一张特例就整体放弃省钱的机会。
 */
export async function extractNoteImageText(imageUrls: string[]): Promise<NoteImageTextResult> {
  const empty: NoteImageTextResult = {
    text: '', ocrCount: 0, modelCount: 0, failures: [], skippedForLimit: 0,
  };
  if (imageUrls.length === 0) return empty;

  const selected = imageUrls.slice(0, MAX_NOTE_IMAGES);
  const skippedForLimit = imageUrls.length - selected.length;
  const workDir = await createImageWorkDir();

  try {
    const slots: Array<{ label: string; text: string | null; file: string | null }> = [];
    const failures: string[] = [];

    for (const [index, url] of selected.entries()) {
      const label = `图 ${index + 1}`;
      let file: string;
      try {
        file = await downloadImage(url, workDir, index + 1);
      } catch (err) {
        failures.push(`${label}：${err instanceof Error ? err.message : String(err)}`);
        slots.push({ label, text: null, file: null });
        continue;
      }

      const ocr = await runOcr(file);
      if (ocr.source === 'ocr') {
        slots.push({ label, text: ocr.text, file });
      } else {
        // 认不出不算失败 —— 交给模型这条路兜着,只是记下为什么退。
        failures.push(`${label}：${ocr.reason ?? 'OCR 不可用'}（改用视觉模型）`);
        slots.push({ label, text: null, file });
      }
    }

    const ocrCount = slots.filter((s) => s.text !== null).length;
    const needModel = slots.filter((s) => s.text === null && s.file);
    let modelCount = 0;

    if (needModel.length > 0) {
      const read = await readImagesWithModel(
        needModel.map((s) => ({ path: s.file as string, label: s.label })),
      );
      if (read.ok) {
        // 按 label 逐张回填。合并成一段再按位置塞会错位 —— 走模型的图不连续时
        // (图1 OCR、图2 模型、图3 OCR、图4 模型),图 4 的文字会跑到图 3 前面。
        for (const page of read.pages) {
          const slot = slots.find((s) => s.label === page.label && s.text === null);
          if (slot && page.text.trim()) {
            slot.text = page.text.trim();
            modelCount += 1;
          }
        }
      } else {
        failures.push(read.reason ?? '视觉模型没能读出文字');
      }
    }

    return {
      text: slots.map((s) => s.text?.trim()).filter(Boolean).join('\n\n').trim(),
      ocrCount,
      modelCount,
      failures,
      skippedForLimit,
    };
  } finally {
    await cleanupImageWorkDir(workDir);
  }
}

const modelReadSchema = z.object({
  pages: z.array(z.object({
    label: z.string().describe('图片编号，如 "图 1"'),
    text: z.string().describe('这张图里的全部文字，按阅读顺序逐字抄下来；没有文字就留空'),
  })),
});

export interface ModelReadResult {
  ok: boolean;
  /** 按图返回,便于回填到正确的位置。 */
  pages: Array<{ label: string; text: string }>;
  reason?: string;
}

/**
 * 把图片交给视觉模型读字。
 *
 * 只让它**抄字**,不让它总结 —— 总结是后面独立的一步,在这儿动手会把原文丢掉,
 * 之后想重新总结也没得可用。
 */
export async function readImagesWithModel(
  files: Array<{ path: string; label: string }>,
): Promise<ModelReadResult> {
  const fail = (reason: string): ModelReadResult => ({ ok: false, pages: [], reason });

  const provider = getDefaultProvider();
  if (!provider) {
    return fail('尚未配置默认 LLM provider，图片里的文字读不出来。');
  }
  if (!providerSupportsCapability(provider, 'text-gen')) {
    return fail(`provider「${provider.name}」不支持文本生成。`);
  }
  const model = resolveProviderModelForRequest(provider, null, 'sonnet');
  if (!model) {
    return fail(`provider「${provider.name}」没有可用的模型。`);
  }

  try {
    const result = await generateObjectFromProvider({
      providerId: provider.id,
      model,
      system: '你是图片文字提取器。逐字抄出图片里的文字，保持原有顺序和分段。'
        + '不要总结、不要改写、不要补充图片里没有的内容。',
      prompt: `下面 ${files.length} 张图来自一条抖音图文作品，按发布顺序排列。`
        + '请把每张图里的文字逐字抄下来。图里没有文字就留空。',
      schema: modelReadSchema,
      images: files.map((f) => ({ path: f.path, label: f.label })),
      maxTokens: 4096,
      temperature: 0,
    });

    const pages = result.pages.filter((page) => page.text.trim());
    if (pages.length === 0) {
      return fail('模型没有从图片里读出文字。');
    }
    return { ok: true, pages };
  } catch (err) {
    return fail(`视觉模型调用失败：${err instanceof Error ? err.message : String(err)}`);
  }
}
