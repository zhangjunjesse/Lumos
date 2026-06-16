// 产品开发 — 在研 listing 的共享类型。data-schema.json 的 etsy_forge_listings 是真源，这里是 TS 视角。
// 设计真源：docs/etsy-forge-product-development-design.md。嵌套结构(图/变体/属性/物流)用 JSON 字段。

export type ListingStatus = 'draft' | 'developing' | 'ready' | 'listed' | 'archived';
export type ListingSourceKind = 'blank' | 'from_group' | 'from_collected';

// Etsy 图位角色(分类展示不同类别的图)。main 必有且唯一 isMain。
export type PhotoRole =
  | 'main'
  | 'model'
  | 'scene'
  | 'flatlay'
  | 'detail'
  | 'size_chart'
  | 'color'
  | 'packaging'
  | 'extra1'
  | 'extra2';
export type PhotoSourceType = 'mockup' | 'asset' | 'upload' | 'generated';

// Etsy 必填三问取值。
export type WhoMade = 'i_did' | 'someone_else' | 'collective';
export type WhatIs = 'finished_product' | 'supply';
export type ListingType = 'physical' | 'digital';
export type Renewal = 'automatic' | 'manual';

export interface ListingPhoto {
  position: number; // 图库内顺序(Etsy 第一张=主图，这里用 isMain 标)
  src: string; // 可直接渲染的 url(/api/media/serve?... 或外链)
  sourceType: PhotoSourceType;
  sourceId?: string; // mockup id / asset id(upload 为空)
  isMain?: boolean;
  role?: PhotoRole; // 来源角色标签(可选，分类展示用)
  label?: string; // 具体来源(如「场景·beach」「颜色·Black」「精修」)
}

export interface VariationProperty {
  name: string; // 'Size' | 'Color' | 自定义
  options: string[];
}
export interface VariationCombo {
  key: string; // 组合键，如 'S|Black'
  price?: number; // 该组合价(空=用基础价)
  quantity?: number;
  sku?: string;
  photoRole?: PhotoRole; // 绑定的颜色/变体图位
}
export interface Variations {
  properties: VariationProperty[];
  combos: VariationCombo[];
}

export interface Personalization {
  enabled: boolean;
  optional: boolean;
  instructions: string;
  charLimit: number;
}

export interface ListingDetails {
  whoMade: WhoMade | '';
  whatIs: WhatIs | '';
  whenMade: string; // catalog.ts WHEN_MADE code
}

export interface ShippingInfo {
  profileName: string;
  processingTime: string;
  countryOfOrigin: string;
  weight: { value: number; unit: 'oz' | 'g' | 'lb' | 'kg' };
  dimensions: { l: number; w: number; h: number; unit: 'in' | 'cm' };
  returnsAccepted: boolean;
  returnWindowDays: number;
}

// 图片异步生成任务(用户选了「异步后台」)：每发起一张/一批记一条，前端轮询出进度，成功后客户端把结果填进图位。
export type PhotoJobStatus = 'running' | 'success' | 'failed';
export interface PhotoGenJobRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  listing_id: string;
  role?: PhotoRole; // 来源标签(精修无)
  label: string; // 展示名(模特图/场景图/姿势图/颜色图/精修)
  status: PhotoJobStatus;
  result_src?: string; // 成功结果(可渲染 src)
  error?: string;
  created_at: string;
  finished_at?: string;
}

// AI 文案草稿暂存(R2 草稿优先)：生成后落这里，用户「采用」才写正式字段。
export interface CopyDraft {
  title?: string;
  description?: string;
  tags?: string[];
  materials?: string[];
  generatedAt?: string;
}

export interface ListingRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  internal_name: string;
  status: ListingStatus;
  source_kind: ListingSourceKind;
  source_product_id?: string;
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  design_src?: string; // 这个产品的印花(所有图位生成的种子)；导入时自动 = 产品图用的印花
  photos: ListingPhoto[];
  video_src?: string;
  price: number;
  currency: string;
  quantity: number;
  sku: string;
  variations: Variations;
  personalization: Personalization;
  taxonomy_path: string[];
  section: string;
  listing_details: ListingDetails;
  listing_type: ListingType;
  renewal: Renewal;
  production_partner: string;
  attributes: Record<string, string>;
  shipping: ShippingInfo;
  copy_draft?: CopyDraft;
  etsy_listing_url?: string;
  etsy_listing_id?: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export const LISTING_LIMITS = {
  TITLE: 140,
  TAGS: 13,
  TAG_LEN: 20,
  MATERIALS: 13,
  PHOTOS: 10,
} as const;

// 新建空白产品的默认值(除 id/user_id/created_at/updated_at，由 store 填)。
export function emptyListingDefaults(): Omit<ListingRow, 'id' | 'user_id' | 'created_at' | 'updated_at'> {
  return {
    internal_name: '未命名产品',
    status: 'draft',
    source_kind: 'blank',
    title: '',
    description: '',
    tags: [],
    materials: [],
    design_src: '',
    photos: [],
    price: 0,
    currency: 'USD',
    quantity: 1,
    sku: '',
    variations: { properties: [], combos: [] },
    personalization: { enabled: false, optional: true, instructions: '', charLimit: 256 },
    taxonomy_path: [],
    section: '',
    listing_details: { whoMade: '', whatIs: '', whenMade: '' },
    listing_type: 'physical',
    renewal: 'automatic',
    production_partner: '',
    attributes: {},
    shipping: {
      profileName: '',
      processingTime: '',
      countryOfOrigin: '',
      weight: { value: 0, unit: 'oz' },
      dimensions: { l: 0, w: 0, h: 0, unit: 'in' },
      returnsAccepted: false,
      returnWindowDays: 30,
    },
    note: '',
  };
}
