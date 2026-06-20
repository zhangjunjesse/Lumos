// 产品开发「图片」批量出图(SOP)：POST {id, colors[], modelRefs?, sceneRefs?, poseRefs?, outputs?}。
// 同步:校验 + 读方向参考成文字(vision) + 起一批 job;再 fire-and-forget 跑(印花当唯一参考)。前端轮询 photo-jobs。

import { NextRequest, NextResponse } from 'next/server';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { getListing } from '@/lib/etsy-forge/listing/store';
import { resolveBatchGen, runPhotoGenJob, type BatchSelection } from '@/lib/etsy-forge/listing/photo-gen';
import { modelDescs, poseDescs, productDescs, sceneDescs } from '@/lib/etsy-forge/listing/vision-brief';
import { startPhotoJob } from '@/lib/etsy-forge/listing/photo-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string } & BatchSelection;
    if (!body.id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const listing = getListing(store, userId, body.id);
    if (!listing) return NextResponse.json({ error: '产品不存在' }, { status: 404 });

    if (!resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false })) {
      return NextResponse.json({ error: '未配置图片服务商（去「设置 → 图片生成」选一个支持图像编辑的服务商）' }, { status: 400 });
    }

    // SOP §2.5:模特/场景/姿势"读图→文字方向"(不喂像素);失败/无识图服务商 → 空,resolveBatchGen 回退默认池。
    // 每个选中的参考图都 vision 详细读成方向文字(并行,图库素材是本地图;采集商品图整体读氛围)。
    const [md, sd, pd, prd] = await Promise.all([
      modelDescs(store, body.modelRefs ?? []),
      sceneDescs(store, body.sceneRefs ?? []),
      poseDescs(store, body.poseRefs ?? []),
      productDescs(store, body.productRefs ?? []),
    ]);
    const dirs = { modelDescs: md, sceneDescs: sd, poseDescs: pd, productDescs: prd };

    const specs = resolveBatchGen(listing, body, dirs); // 校验失败抛 → 400

    const jobIds = specs.map((s) => {
      const job = startPhotoJob(store, userId, body.id as string, s.label, s.role, s.prompt);
      void runPhotoGenJob(store, job.id, [s.ref], s.prompt).catch(() => {});
      return job.id;
    });

    // 回传本批实际用到的方向(供前端显示,让"读到没/用了什么"可见,不再黑箱)。
    return NextResponse.json({ ok: true, started: jobIds.length, jobIds, dirs });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
