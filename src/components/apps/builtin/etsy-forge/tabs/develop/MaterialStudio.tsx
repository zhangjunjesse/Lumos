'use client';

// SOP 批量出图,分 tab。方向参考再分子 tab:模特/场景/姿势(AI素材) + 已采集商品/我关注的商品(真实图,整体读氛围方向)。
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DEFAULT_STYLE, PHOTO_STYLES, SHIRT_COLORS } from '@/lib/etsy-forge/listing/photo-roles';
import { ImageLightbox } from '../ImageLightbox';
import { listingApi } from './listing-api';
import { MaterialPickerGrid, type BaseMaterial } from './MaterialPickerGrid';

export interface BatchSel {
  colors: string[];
  style: string;
  extra: string;
  modelCount: number;
  modelRefs: string[]; // src,后端每次 vision 详细读(不复用素材里存的干瘪描述)
  sceneRefs: string[];
  poseRefs: string[];
  productRefs: string[];
  outputs: { model: boolean; scene: boolean; detail: boolean; flat: boolean };
}

const OUTPUTS: { key: keyof BatchSel['outputs']; label: string }[] = [
  { key: 'model', label: '模特上身(每色)' },
  { key: 'scene', label: '场景氛围' },
  { key: 'detail', label: '设计特写' },
  { key: 'flat', label: '平铺白底主图' },
];
type DirKey = 'model' | 'scene' | 'pose' | 'collected' | 'followed';
const DIR_ORDER: { key: DirKey; label: string }[] = [
  { key: 'model', label: '模特' },
  { key: 'scene', label: '场景' },
  { key: 'pose', label: '姿势' },
  { key: 'collected', label: '已采集商品' },
  { key: 'followed', label: '我关注的商品' },
];

interface Props {
  materialsByCat: Record<string, BaseMaterial[]>;
  collectedProducts: BaseMaterial[];
  followedProducts: BaseMaterial[];
  generating: boolean;
  onGenerate: (sel: BatchSel) => void;
}

export function MaterialStudio({ materialsByCat, collectedProducts, followedProducts, generating, onGenerate }: Props) {
  const [tab, setTab] = useState('basic');
  const [dirTab, setDirTab] = useState<DirKey>('model');
  const [colors, setColors] = useState<string[]>(['Pepper']);
  const [style, setStyle] = useState(DEFAULT_STYLE);
  const [extra, setExtra] = useState('');
  const [modelCount, setModelCount] = useState(4);
  const [outputs, setOutputs] = useState({ model: true, scene: true, detail: true, flat: true });
  const [modelRefs, setModelRefs] = useState<string[]>([]);
  const [sceneRefs, setSceneRefs] = useState<string[]>([]);
  const [poseRefs, setPoseRefs] = useState<string[]>([]);
  const [productRefs, setProductRefs] = useState<string[]>([]);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [savedExtras, setSavedExtras] = useState<{ id: string; text: string }[]>([]);

  const reloadExtras = useCallback(() => {
    listingApi.listExtraPrompts().then((r) => setSavedExtras(r.prompts)).catch(() => {});
  }, []);
  useEffect(() => {
    reloadExtras();
  }, [reloadExtras]);
  const saveExtra = () => {
    const t = extra.trim();
    if (!t) return;
    listingApi.saveExtraPrompt(t).then(() => reloadExtras()).catch(() => {});
  };
  const delExtra = (id: string) => {
    listingApi.deleteExtraPrompt(id).then(() => reloadExtras()).catch(() => {});
  };

  const toggleColor = (n: string) => setColors((cs) => (cs.includes(n) ? cs.filter((c) => c !== n) : [...cs, n]));
  const toggleOut = (k: keyof typeof outputs) => setOutputs((o) => ({ ...o, [k]: !o[k] }));
  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs ${on ? 'bg-foreground text-background' : 'hover:bg-muted'}`;

  // 每个方向子 tab 的素材/选中/写入。已采集 + 关注 都写进 productRefs(整体氛围方向)。
  const dir: Record<DirKey, { title: string; materials: BaseMaterial[]; selected: string[]; onChange: (s: string[]) => void; hint: string }> = {
    model: { title: '模特方向', materials: materialsByCat.model ?? [], selected: modelRefs, onChange: setModelRefs, hint: '图库暂无模特素材' },
    scene: { title: '场景方向', materials: materialsByCat.scene ?? [], selected: sceneRefs, onChange: setSceneRefs, hint: '图库暂无场景素材' },
    pose: { title: '姿势方向', materials: materialsByCat.pose ?? [], selected: poseRefs, onChange: setPoseRefs, hint: '图库暂无姿势素材' },
    collected: { title: '已采集商品(整体氛围参考)', materials: collectedProducts, selected: productRefs, onChange: setProductRefs, hint: '去「采集任务」爬商品后出现' },
    followed: { title: '我关注的商品(整体氛围参考)', materials: followedProducts, selected: productRefs, onChange: setProductRefs, hint: '去「我关注的商品」加商品后出现' },
  };
  const active = dir[dirTab];

  const anyOut = outputs.model || outputs.scene || outputs.detail || outputs.flat;
  const n = (outputs.model ? modelCount : 0) + (outputs.scene ? 2 : 0) + (outputs.detail ? 1 : 0) + (outputs.flat ? 1 : 0);

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">SOP 批量出商品图：印花当唯一真图参考，AI 生成全新模特/场景（合规不抄袭）</p>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="basic">基础</TabsTrigger>
          <TabsTrigger value="style">风格</TabsTrigger>
          <TabsTrigger value="dir">方向参考</TabsTrigger>
          <TabsTrigger value="extra">额外要求</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="mt-3 space-y-3">
          <div>
            <p className="mb-1 text-sm font-medium">T 恤颜色（每色一张模特图轮换）</p>
            <div className="flex flex-wrap gap-1.5">
              {SHIRT_COLORS.map((c) => (
                <button key={c.name} type="button" onClick={() => toggleColor(c.name)} className={chip(colors.includes(c.name))}>{c.label}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">输出类型</p>
            <div className="flex flex-wrap gap-3">
              {OUTPUTS.map((o) => (
                <label key={o.key} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={outputs[o.key]} onChange={() => toggleOut(o.key)} className="size-4" />
                  {o.label}
                </label>
              ))}
            </div>
            {outputs.model && (
              <label className="mt-2 flex items-center gap-2 text-sm">
                模特上身图张数
                <input type="number" min={1} max={8} value={modelCount} onChange={(e) => setModelCount(Math.max(1, Math.min(8, Number(e.target.value) || 1)))} className="h-8 w-20 rounded-md border border-input bg-background px-2" />
                <span className="text-xs text-muted-foreground">SOP 建议 3-4，每张换人换景换颜色</span>
              </label>
            )}
          </div>
        </TabsContent>

        <TabsContent value="style" className="mt-3">
          <div className="flex flex-wrap gap-1.5">
            {PHOTO_STYLES.map((s) => (
              <button key={s.key} type="button" onClick={() => setStyle(s.key)} className={chip(style === s.key)}>{s.label}</button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">模特/场景图按这个调性出；平铺主图、设计特写保持干净不受影响。</p>
        </TabsContent>

        <TabsContent value="dir" className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">AI「读图取方向」(姿势/调性/光)生成全新人/景，绝不照搬像素(SOP)。优先级:选了「已采集/我关注的商品」→ 照那张整体氛围出(最强);否则用模特/场景/姿势组合;都没选用默认。生成后看上方「本批方向」确认用了什么。</p>
          <div className="flex flex-wrap gap-1.5">
            {DIR_ORDER.map((t) => {
              const cnt = dir[t.key].selected.length;
              return (
                <button key={t.key} type="button" onClick={() => setDirTab(t.key)} className={chip(dirTab === t.key)}>
                  {t.label}{cnt > 0 ? ` (${cnt})` : ''}
                </button>
              );
            })}
          </div>
          <div className="max-h-56 overflow-y-auto rounded-md border bg-muted/20 p-2">
            <MaterialPickerGrid title={active.title} mode="multi" materials={active.materials} selected={active.selected} onChange={active.onChange} onZoom={setZoomSrc} emptyHint={active.hint} />
          </div>
        </TabsContent>

        <TabsContent value="extra" className="mt-3">
          <p className="mb-1 text-sm font-medium">额外要求（自由输入）</p>
          <textarea
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            rows={4}
            placeholder="例:模特戴渔夫帽、背景多点绿植、整体偏 ins 清新、避免出现文字…"
            className="w-full resize-y rounded-md border border-input bg-background p-2 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">这些要求会加到 模特/场景/特写/平铺 每张图的生成提示词里(结构化选项之外的补充)。</p>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={!extra.trim()} onClick={saveExtra}>保存为常用</Button>
            <span className="text-xs text-muted-foreground">存下来下次直接点用</span>
          </div>
          {savedExtras.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-xs text-muted-foreground">常用要求(点击载入):</p>
              <div className="flex flex-wrap gap-1.5">
                {savedExtras.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                    <button type="button" onClick={() => setExtra(s.text)} className="max-w-[220px] truncate hover:underline" title={s.text}>{s.text}</button>
                    <button type="button" onClick={() => delExtra(s.id)} className="text-muted-foreground hover:text-destructive" aria-label="删除">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <div className="flex items-center gap-3 border-t pt-3">
        <Button disabled={colors.length === 0 || !anyOut || generating} onClick={() => onGenerate({ colors, style, extra, modelCount, modelRefs, sceneRefs, poseRefs, productRefs, outputs })}>
          {generating ? '生成中…' : `生成这批${n > 0 ? ` · ${n} 张` : ''}`}
        </Button>
        {colors.length === 0 && <span className="text-xs text-amber-600">基础 tab 选至少一个颜色</span>}
      </div>

      {zoomSrc && <ImageLightbox images={[{ url: zoomSrc }]} index={0} onIndexChange={() => {}} onClose={() => setZoomSrc(null)} />}
    </div>
  );
}
