// 兼容入口 — 实现已迁到共享模块 src/lib/browser-runtime/adspower-cdp.ts。
// Pinterest / Etsy / 后续选品应用共用同一个 AdsPower 入口。
export {
  startAdsPower,
  probeAdsPower,
  resolveAdsPowerProfileFromContext,
  startAdsPowerForContext,
  type AdsPowerHandle,
  type AdsPowerStatus,
} from '@/lib/browser-runtime/adspower-cdp';
