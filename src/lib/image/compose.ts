// 纯程序图片合成(sharp,零 LLM):把印花贴到固定底图(T恤模板)的印花区上。
// 背景抠除用「边缘主色 + 容差 flood-fill」:采样四边像素的主色当背景色(白底/黑底/纯色底通吃),
// 只透明化与边缘连通的背景区域——印花内部同色元素(白字/黑块)保留。
// 健全性检查:抠得太少(满幅海报式设计,没有"底"可言)或太多(把主体打穿)都回退整图直贴。

import sharp from 'sharp';

export interface PrintArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

const COLOR_TOLERANCE = 22; // 与背景主色的每通道容差(容忍生成图噪点/压缩伪影)
const MIN_STRIP_RATIO = 0.05; // 抠除面积低于 5%:视为满幅设计,直贴
const MAX_STRIP_RATIO = 0.7; // 抠除面积高于 70%:大概率误伤主体,直贴

// 背景抠除:返回处理后 PNG;不适合抠(满幅/误伤)时返回原图 PNG。
export async function stripBackground(inputPath: string): Promise<Buffer> {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const bg = sampleEdgeDominantColor(data, width, height, channels);
  const matchesBg = (idx: number) =>
    Math.abs(data[idx] - bg[0]) <= COLOR_TOLERANCE &&
    Math.abs(data[idx + 1] - bg[1]) <= COLOR_TOLERANCE &&
    Math.abs(data[idx + 2] - bg[2]) <= COLOR_TOLERANCE;

  // BFS:从四边所有背景色像素起洪泛,标记「外围背景」。
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const push = (px: number, py: number) => {
    const p = py * width + px;
    if (visited[p]) return;
    if (!matchesBg(p * channels)) return;
    visited[p] = 1;
    queue[tail++] = p;
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (head < tail) {
    const p = queue[head++];
    const px = p % width;
    const py = (p / width) | 0;
    if (px > 0) push(px - 1, py);
    if (px < width - 1) push(px + 1, py);
    if (py > 0) push(px, py - 1);
    if (py < height - 1) push(px, py + 1);
  }

  const stripRatio = tail / (width * height);
  if (stripRatio < MIN_STRIP_RATIO || stripRatio > MAX_STRIP_RATIO) {
    return sharp(inputPath).png().toBuffer();
  }

  for (let p = 0; p < width * height; p++) {
    if (visited[p]) data[p * channels + 3] = 0;
  }
  return sharp(data, { raw: { width, height, channels: channels as 4 } })
    .png()
    .toBuffer();
}

// 四边像素颜色量化(每通道 /32)统计众数 → 背景主色估计。
function sampleEdgeDominantColor(data: Uint8Array | Buffer, width: number, height: number, channels: number): [number, number, number] {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const sample = (px: number, py: number) => {
    const i = (py * width + px) * channels;
    const key = ((data[i] >> 5) << 10) | ((data[i + 1] >> 5) << 5) | (data[i + 2] >> 5);
    const entry = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    entry.n += 1;
    entry.r += data[i];
    entry.g += data[i + 1];
    entry.b += data[i + 2];
    counts.set(key, entry);
  };
  for (let x = 0; x < width; x++) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    sample(0, y);
    sample(width - 1, y);
  }
  let best: { n: number; r: number; g: number; b: number } | undefined;
  for (const entry of counts.values()) {
    if (!best || entry.n > best.n) best = entry;
  }
  if (!best) return [255, 255, 255];
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
}

// 把印花(PNG buffer 或文件)等比缩放后居中贴进底图的印花区。整个过程本地毫秒级,零 token。
export async function composePrintOnBase(opts: {
  basePath: string;
  print: Buffer | string;
  printArea: PrintArea;
  outPath: string;
}): Promise<void> {
  const { basePath, print, printArea, outPath } = opts;
  const resized = await sharp(print)
    .resize(Math.round(printArea.w), Math.round(printArea.h), { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true });

  // fit:'inside' 后按实际尺寸在印花区内居中
  const left = Math.round(printArea.x + (printArea.w - resized.info.width) / 2);
  const top = Math.round(printArea.y + (printArea.h - resized.info.height) / 2);

  await sharp(basePath)
    .composite([{ input: resized.data, left, top }])
    .png()
    .toFile(outPath);
}
