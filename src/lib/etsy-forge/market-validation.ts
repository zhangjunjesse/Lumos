// Step 2.5 市场验证:把 ②a 评论分析(这个竞品爆款自己的真实评论)整理成「验证数据段」,喂进二创拆解,
// 让 niche/语义 在真实买家数据上收敛、而不是靠看图猜。设计类好评=必须保留、设计类差评=可改进,产品类(尺码/材质/物流)仅记录——
// 这一步交给拆解模型自己判(不维护脆弱关键词表)。没评论就不喂,拆解里 niche 标「未验证·基于推断」。不伪造数据。

import type { ReviewAnalysis, ReviewTopic } from './types';

export interface MarketValidation {
  verified: boolean; // 有真实评论数据
  reviewsUsed: number;
  promptSection: string; // 喂进拆解 prompt 的「验证数据 + 指令」段;无数据则空串
}

function topicLines(arr: ReviewTopic[]): string {
  return arr
    .map((t) => `- ${t.topic}${t.reason ? ` (${t.reason})` : ''}`)
    .filter(Boolean)
    .join('\n');
}

export function buildMarketValidation(analysis?: ReviewAnalysis): MarketValidation {
  if (!analysis || !analysis.reviewsAnalyzed) return { verified: false, reviewsUsed: 0, promptSection: '' };
  const p = analysis.customerProfile;
  const lines = [
    '--- VERIFIED MARKET DATA (real buyer reviews of THIS listing) ---',
    `Reviews analyzed: ${analysis.reviewsAnalyzed}`,
    `Buyers: ${p.genderFemalePct}% female / ${p.genderMalePct}% male${p.who ? ` · ${p.who}` : ''}`,
    [p.when && `when: ${p.when}`, p.where && `where: ${p.where}`, p.what && `what: ${p.what}`].filter(Boolean).join(' · '),
    analysis.pros.length ? `Praised (Pros):\n${topicLines(analysis.pros)}` : '',
    analysis.cons.length ? `Complained (Cons):\n${topicLines(analysis.cons)}` : '',
    analysis.motivations.length ? `Buying motivations:\n${topicLines(analysis.motivations)}` : '',
    'USE THIS VERIFIED DATA to converge the niches and semantics on these REAL buyers — do NOT guess. For each niche set "verified":"yes" only when it is backed by this data, else "no". YOU decide which praise/complaints are DESIGN-related (design / graphic / color / style / cuteness / theme): design-related praise is MUST-KEEP — reflect it in facts.keep and style_retention; design-related complaints are improvement opportunities — reflect in facts.replace. IGNORE product / sizing / material / shipping / smell feedback for the artwork. If this verified data conflicts with what the image alone suggests, PREFER the verified data.',
  ].filter(Boolean);
  return { verified: true, reviewsUsed: analysis.reviewsAnalyzed, promptSection: lines.join('\n') };
}
