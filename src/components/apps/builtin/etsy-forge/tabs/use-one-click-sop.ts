'use client';

// 「一键出品」SOP 启动。不再弹进度框:发起后派发 etsy-sop-started 事件,任务进右下角「任务」按钮里看。
// start 返回错误文案(或 null),由调用方决定如何展示。

import { useState } from 'react';
import { etsyForgeApi } from '../api-client';

export function useOneClickSop() {
  const [sopStarting, setSopStarting] = useState(false);

  const startSop = async (productIds: string[], directions?: string[]): Promise<string | null> => {
    if (productIds.length === 0) return null;
    const dirText = directions && directions.length ? `二创方向 ${directions.join('/')}` : '二创方向默认 B';
    if (
      !confirm(
        `对 ${productIds.length} 个选中商品「一键出品」(${dirText})？逐商品走 8 步(采集详情→采集店铺→评论分析→图片分类→抠印花→素材+姿势→二创→出产品图;采集店铺失败不挡出图)，多商品按「设置→图片生成并发度」并行(采集详情/店铺会自动排队避免抢浏览器)。后台跑，进度去右下角「任务」按钮看、失败可单步重试。`,
      )
    )
      return null;
    setSopStarting(true);
    try {
      await etsyForgeApi.startSop(productIds, directions);
      window.dispatchEvent(new CustomEvent('etsy-sop-started'));
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    } finally {
      setSopStarting(false);
    }
  };

  return { sopStarting, startSop };
}
