// compose 合成引擎单测:背景抠除三分支(抠底/满幅直贴回退/误伤回退)+印花区居中合成。
// 测试图全部用 sharp 程序生成,不依赖外部文件;真跑 sharp(native),不 mock。

import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { composePrintOnBase, stripBackground } from '../compose';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-test-'));

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// 生成「bg 底色 + 中心 fg 方块」的测试图,返回文件路径。
async function makeCenterBlockImage(name: string, bg: { r: number; g: number; b: number }, fg: { r: number; g: number; b: number }, size = 120, block = 40): Promise<string> {
  const file = path.join(tmpDir, name);
  const inner = await sharp({ create: { width: block, height: block, channels: 4, background: { ...fg, alpha: 1 } } }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { ...bg, alpha: 1 } } })
    .composite([{ input: inner, left: (size - block) / 2, top: (size - block) / 2 }])
    .png()
    .toFile(file);
  return file;
}

async function readRgba(buf: Buffer) {
  return sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function alphaAt(data: Buffer, info: { width: number; channels: number }, x: number, y: number): number {
  return data[(y * info.width + x) * info.channels + 3];
}

describe('stripBackground', () => {
  it('白底图:外围白底透明、中心图案保留', async () => {
    const file = await makeCenterBlockImage('white-bg.png', { r: 255, g: 255, b: 255 }, { r: 200, g: 30, b: 30 });
    const out = await stripBackground(file);
    const { data, info } = await readRgba(out);
    expect(alphaAt(data, info, 2, 2)).toBe(0); // 角落背景已透明
    expect(alphaAt(data, info, 60, 60)).toBe(255); // 中心图案不透明
  });

  it('黑底图:外围黑底同样被抠(边缘主色采样,不限白色)', async () => {
    const file = await makeCenterBlockImage('black-bg.png', { r: 8, g: 8, b: 8 }, { r: 240, g: 200, b: 40 });
    const out = await stripBackground(file);
    const { data, info } = await readRgba(out);
    expect(alphaAt(data, info, 2, 2)).toBe(0);
    expect(alphaAt(data, info, 60, 60)).toBe(255);
  });

  it('印花内部与底色相同的封闭区域不被误穿(只抠与边缘连通的背景)', async () => {
    // 白底 + 红色大块 + 红块中心再嵌一个白色小块(白色但不连通边缘)
    const file = path.join(tmpDir, 'nested.png');
    const whiteInner = await sharp({ create: { width: 12, height: 12, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
    const red = await sharp({ create: { width: 60, height: 60, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } })
      .composite([{ input: whiteInner, left: 24, top: 24 }])
      .png()
      .toBuffer();
    await sharp({ create: { width: 120, height: 120, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
      .composite([{ input: red, left: 30, top: 30 }])
      .png()
      .toFile(file);

    const out = await stripBackground(file);
    const { data, info } = await readRgba(out);
    expect(alphaAt(data, info, 2, 2)).toBe(0); // 外围白底透明
    expect(alphaAt(data, info, 60, 60)).toBe(255); // 内嵌白块保留(不与边缘连通)
  });

  it('满幅设计(噪声边缘无统一底色,抠除面积<5%)回退整图直贴', async () => {
    // 全图伪随机噪声(固定种子,确定性):边缘没有主导底色,flood 灌不动
    const file = path.join(tmpDir, 'full-bleed.png');
    const size = 120;
    const raw = Buffer.alloc(size * size * 4);
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 8) & 0xff;
    for (let p = 0; p < size * size; p++) {
      raw[p * 4] = rand();
      raw[p * 4 + 1] = rand();
      raw[p * 4 + 2] = rand();
      raw[p * 4 + 3] = 255;
    }
    await sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toFile(file);

    const out = await stripBackground(file);
    const { data, info } = await readRgba(out);
    // 回退直贴:没有任何像素被透明化
    let transparent = 0;
    for (let p = 0; p < info.width * info.height; p++) {
      if (data[p * info.channels + 3] === 0) transparent += 1;
    }
    expect(transparent).toBe(0);
  });

  it('几乎整图都是底色(抠除>70%,会把主体打穿)回退整图直贴', async () => {
    const file = await makeCenterBlockImage('tiny-subject.png', { r: 255, g: 255, b: 255 }, { r: 20, g: 20, b: 20 }, 200, 10);
    const out = await stripBackground(file);
    const { data, info } = await readRgba(out);
    expect(alphaAt(data, info, 2, 2)).toBe(255); // 没抠:角落仍不透明
  });
});

describe('composePrintOnBase', () => {
  it('印花等比缩放后落在印花区内居中,底图其余区域不动', async () => {
    const base = path.join(tmpDir, 'base.png');
    await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toFile(base);
    // 宽印花(2:1)贴进 80x80 区 → fit inside 后 80x40,垂直居中
    const print = await sharp({ create: { width: 100, height: 50, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const out = path.join(tmpDir, 'composed.png');
    await composePrintOnBase({ basePath: base, print, printArea: { x: 60, y: 60, w: 80, h: 80 }, outPath: out });

    const { data, info } = await readRgba(await fs.promises.readFile(out));
    const px = (x: number, y: number) => data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3);
    expect(Array.from(px(100, 100))).toEqual([255, 0, 0]); // 印花区中心=印花色
    expect(Array.from(px(100, 70))).toEqual([0, 0, 255]); // 印花区内上沿(居中留空处)=底图色
    expect(Array.from(px(10, 10))).toEqual([0, 0, 255]); // 区外=底图色
  });
});
