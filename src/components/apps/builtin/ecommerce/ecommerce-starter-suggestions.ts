export interface EcommerceStarterSuggestion {
  id: string;
  label: string;
  prompt: string;
}

export const ECOMMERCE_STARTER_SUGGESTIONS: readonly EcommerceStarterSuggestion[] = [
  {
    id: 'how-to-add-product',
    label: '怎么新增一个商品',
    prompt: '我刚拍好一组主图，想把它录入电商助手，从哪里开始？需要准备哪些字段才能跑后面的图像任务？',
  },
  {
    id: 'image-strategy',
    label: '主图 / 生活方式图怎么拍',
    prompt: '我要在 Etsy 上卖一只手作陶瓷杯，主图、细节图、生活方式图分别该怎么构图？平台对主图有什么硬性要求？',
  },
  {
    id: 'preset-vs-job',
    label: '预设 vs 任务的区别',
    prompt: '"预设" 标签页和 "任务" 标签页有什么区别？我应该先建预设还是直接跑一个任务？',
  },
  {
    id: 'listing-copy',
    label: '帮我写一段 listing 文案',
    prompt: '帮我写一段 Etsy listing 文案：手作陶瓷咖啡杯，复古做旧，容量 250ml，目标客户是 25-35 岁咖啡爱好者。要标题、5 条 bullet、200 字以内的描述。',
  },
  {
    id: 'job-failed',
    label: '任务失败了怎么办',
    prompt: '我在"任务"标签看到一个失败的任务，要怎么排查？能在应用里直接重试吗？',
  },
];
