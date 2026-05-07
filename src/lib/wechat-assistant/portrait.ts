import type { WeChatSnapshot } from './analysis';
import {
  buildHighlights,
  type PortraitHighlight,
} from './portrait-highlights';
import {
  buildRhythm,
  buildStyle,
  type PortraitRhythm,
  type PortraitStyle,
} from './portrait-rhythm';
import {
  buildGroups,
  buildRelationships,
  buildResponsiveness,
  type PortraitGroups,
  type PortraitRelationships,
  type PortraitResponsiveness,
} from './portrait-relations';

export type { PortraitHighlight } from './portrait-highlights';
export type { PortraitRhythm, PortraitStyle } from './portrait-rhythm';
export type {
  PortraitGroups,
  PortraitRelationships,
  PortraitResponsiveness,
  PortraitContact,
  RisingContact,
  SilentContact,
  ResponseEntry,
  GroupRoleEntry,
} from './portrait-relations';

export interface WeChatPortrait {
  generated: boolean;
  rhythm: PortraitRhythm;
  relationships: PortraitRelationships;
  responsiveness: PortraitResponsiveness;
  style: PortraitStyle;
  groups: PortraitGroups;
  highlights: PortraitHighlight[];
}

export function buildWeChatPortrait(snapshot: WeChatSnapshot): WeChatPortrait {
  const usable = snapshot.messages.filter(
    (m) => m.content.trim() && m.type !== 10000 && m.type !== 10002,
  );
  if (usable.length === 0) return emptyPortrait();
  const rhythm = buildRhythm(usable);
  const style = buildStyle(usable);
  const relationships = buildRelationships(usable);
  const responsiveness = buildResponsiveness(usable);
  const groups = buildGroups(usable);
  const highlights = buildHighlights(usable, rhythm, style, responsiveness);
  return { generated: true, rhythm, relationships, responsiveness, style, groups, highlights };
}

function emptyPortrait(): WeChatPortrait {
  return {
    generated: false,
    rhythm: {
      label: '尚无足够数据',
      summary: '还没有读取到可分析的消息。',
      hourly: [],
      weekly: [],
      peakHour: 0,
      peakHourCount: 0,
      earliestHour: null,
      latestHour: null,
      weekdayShare: 0,
      weekendShare: 0,
      lateNightShare: 0,
      daysActive: 0,
    },
    relationships: { summary: '尚无可分析的会话。', rising: [], fading: [], silent: [] },
    responsiveness: {
      summary: '尚未形成可统计的对话样本。',
      yourMedianMinutes: null,
      yourSampleSize: 0,
      theirMedianMinutes: null,
      theirSampleSize: 0,
      fastestForYou: [],
      slowestForYou: [],
    },
    style: {
      label: '尚无样本',
      summary: '还没有读取到你发出的消息。',
      yourMessageCount: 0,
      avgLength: 0,
      longestLength: 0,
      questionRate: 0,
      exclaimRate: 0,
      emojiTop: [],
      wordTop: [],
    },
    groups: { summary: '暂未读取到群聊数据。', topGroups: [] },
    highlights: [],
  };
}
