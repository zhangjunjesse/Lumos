import { buildWeChatPortrait, type WeChatPortrait } from './portrait';
import { displayWechatName, safeSanitizedWechatText } from './wechat-text';

export type { WeChatPortrait } from './portrait';

export interface WeChatSnapshotSession {
  wxid: string;
  display: string;
  summary?: string;
  last_timestamp?: number;
  unread_count?: number;
  is_group?: boolean;
}

export interface WeChatSnapshotMessage {
  wxid: string;
  display: string;
  isGroup: boolean;
  ts: number;
  sender: 'me' | 'them';
  senderWxid?: string | null;
  senderDisplay?: string | null;
  type: number;
  content: string;
}

export interface WeChatSnapshot {
  sessions: WeChatSnapshotSession[];
  messages: WeChatSnapshotMessage[];
  sessionsScanned: number;
  messagesScanned: number;
  totalReadableMessages: number;
  selectedReadableMessages: number;
  messagesTruncated: boolean;
  scanScope: 'all_readable_wechat_messages' | 'limited_recent_sessions' | string;
  safetyLimit: number;
}

export interface WeChatAssistantAnalysis {
  generatedAt: number;
  summary: string;
  source: {
    scope: string;
    sessionsScanned: number;
    messagesScanned: number;
    totalReadableMessages: number;
    selectedReadableMessages: number;
    messagesTruncated: boolean;
    scanScope: string;
    safetyLimit: number;
    todayMessages: number;
    unreadSessions: number;
  };
  metrics: Array<{ label: string; value: string; detail: string }>;
  highlights: Array<{
    title: string;
    description: string;
    tone: 'default' | 'warning' | 'danger' | 'success';
    wxid?: string;
    display?: string;
    ts?: number;
  }>;
  todos: Array<{
    text: string;
    display: string;
    ts: number;
    confidence: 'high' | 'medium';
  }>;
  topConversations: Array<{
    wxid: string;
    display: string;
    count: number;
    unread: number;
    lastAt: number;
    isGroup: boolean;
  }>;
  keywordTrends: Array<{ keyword: string; count: number }>;
  contentInsights: {
    summary: string;
    topics: WeChatContentTopic[];
    relationshipSignals: WeChatRelationshipSignal[];
    drafts: WeChatContentDraft[];
    channelSuggestions: WeChatChannelSuggestion[];
  };
  portrait: WeChatPortrait;
}

export interface WeChatContentTopic {
  id: string;
  title: string;
  theme: string;
  angle: string;
  format: string;
  score: number;
  reason: string;
  interestLabel: string;
  interestReason: string;
  spreadLabel: string;
  spreadNarrative: string;
  messageCount: number;
  conversationCount: number;
  groupCount: number;
  contactCount: number;
  tags: string[];
  examples: Array<{
    display: string;
    ts: number;
    text: string;
  }>;
  sources: Array<{
    wxid: string;
    display: string;
    count: number;
    isGroup: boolean;
    firstAt: number;
    lastAt: number;
  }>;
}

export interface WeChatRelationshipSignal {
  label: string;
  description: string;
  value: string;
  contacts: Array<{
    wxid: string;
    display: string;
    count: number;
    isGroup: boolean;
    firstAt: number;
    lastAt: number;
  }>;
}

export interface WeChatContentDraft {
  title: string;
  hook: string;
  format: string;
  outline: string[];
  sourceTopic: string;
  privacyNote: string;
}

export interface WeChatChannelSuggestion {
  channel: '朋友圈' | '公众号' | '短视频' | '选题库';
  title: string;
  fit: string;
  nextAction: string;
  sourceTopic: string;
}

interface ContentTheme {
  id: string;
  label: string;
  keywords: string[];
  angle: string;
  format: string;
  tags: string[];
}

interface ConversationSignal {
  wxid: string;
  display: string;
  isGroup: boolean;
  count: number;
  incoming: number;
  questionCount: number;
  requestCount: number;
  firstAt: number;
  lastAt: number;
}

const IMPORTANT_KEYWORDS = [
  '紧急',
  '尽快',
  '马上',
  '今天',
  '截止',
  '合同',
  '付款',
  '支付',
  '发票',
  '报价',
  '投诉',
  '风险',
  '客户',
  '问题',
  '确认',
  'deadline',
  'asap',
];

const TODO_KEYWORDS = [
  '需要',
  '麻烦',
  '帮我',
  '帮忙',
  '记得',
  '安排',
  '处理',
  '跟进',
  '确认',
  '回复',
  '发给',
  '整理',
  '改一下',
  '看一下',
];

const TREND_KEYWORDS = [
  '合同',
  '付款',
  '发票',
  '报价',
  '客户',
  '会议',
  '需求',
  '方案',
  '交付',
  '问题',
  '投诉',
  '紧急',
  '待办',
  '确认',
  '回复',
];

const CONTENT_THEMES: ContentTheme[] = [
  {
    id: 'decision',
    label: '决策推进',
    keywords: ['确认', '决定', '定下来', '方案', '需求', '安排', '推进', '计划', '落地', '交付'],
    angle: '把反复出现的确认、推进、交付问题，整理成“如何把事情往前推”的方法型内容。',
    format: '清单帖',
    tags: ['决策', '协作', '方法'],
  },
  {
    id: 'money',
    label: '价格与交易',
    keywords: ['付款', '支付', '报价', '发票', '合同', '价格', '费用', '订单', '转账'],
    angle: '从真实沟通里的报价、付款、合同细节，提炼交易决策中的常见顾虑。',
    format: '避坑帖',
    tags: ['交易', '信任', '避坑'],
  },
  {
    id: 'problem',
    label: '问题与风险',
    keywords: ['问题', '不行', '失败', '风险', '投诉', '麻烦', '卡住', 'bug', '错误', '延迟'],
    angle: '把聊天里的卡点、风险和吐槽，转成有共鸣的痛点观察。',
    format: '观点帖',
    tags: ['痛点', '风险', '共鸣'],
  },
  {
    id: 'followup',
    label: '待办与跟进',
    keywords: ['跟进', '回复', '提醒', '需要', '麻烦', '帮忙', '处理', '看一下', '发给', '整理'],
    angle: '从别人反复拜托你的事项里，发现用户真正需要的工具、服务或经验。',
    format: '问答帖',
    tags: ['待办', '需求', '服务'],
  },
  {
    id: 'knowledge',
    label: '经验与资料',
    keywords: ['资料', '文档', '教程', '方法', '经验', '学习', '总结', '分享', '案例'],
    angle: '把聊天里反复要资料、要方法的内容，整理成可复用的经验包。',
    format: '资料包',
    tags: ['经验', '知识', '资料'],
  },
  {
    id: 'trend',
    label: '新鲜变化',
    keywords: ['最近', '现在', '今年', '趋势', '变化', '热点', 'AI', '模型', '视频号', '小红书', '抖音'],
    angle: '从关系圈里正在讨论的新变化，提炼“大家为什么突然关心它”的选题。',
    format: '趋势短评',
    tags: ['趋势', '热点', '观察'],
  },
];

const QUESTION_KEYWORDS = ['?', '？', '吗', '怎么', '如何', '为什么', '怎么办', '有没有', '能不能'];
const TENSION_KEYWORDS = ['问题', '不行', '失败', '风险', '投诉', '麻烦', '卡住', '紧急', '尽快', '截止', '延迟'];

export function buildWeChatAssistantAnalysis(snapshot: WeChatSnapshot): WeChatAssistantAnalysis {
  const now = Date.now();
  const todayStart = startOfTodaySeconds();
  const sessions = snapshot.sessions.map(sanitizeSnapshotSession);
  const usefulMessages = snapshot.messages
    .map(sanitizeSnapshotMessage)
    .filter((message) => message.content.trim() && message.type !== 10000 && message.type !== 10002)
    .sort((a, b) => b.ts - a.ts);
  const todayMessages = usefulMessages.filter((message) => message.ts >= todayStart);
  const receivedToday = todayMessages.filter((message) => message.sender === 'them');
  const unreadSessions = sessions.filter((session) => (session.unread_count ?? 0) > 0).length;
  const activeMap = new Map<string, {
    wxid: string;
    display: string;
    count: number;
    unread: number;
    lastAt: number;
    isGroup: boolean;
  }>();

  for (const session of sessions) {
    activeMap.set(session.wxid, {
      wxid: session.wxid,
      display: session.display,
      count: 0,
      unread: session.unread_count ?? 0,
      lastAt: session.last_timestamp ?? 0,
      isGroup: !!session.is_group,
    });
  }
  for (const message of usefulMessages) {
    const item = activeMap.get(message.wxid) ?? {
      wxid: message.wxid,
      display: message.display,
      count: 0,
      unread: 0,
      lastAt: 0,
      isGroup: message.isGroup,
    };
    item.count += 1;
    item.lastAt = Math.max(item.lastAt, message.ts);
    activeMap.set(message.wxid, item);
  }

  const topConversations = Array.from(activeMap.values())
    .filter((item) => item.count > 0 || item.unread > 0)
    .sort((a, b) => b.count - a.count || b.unread - a.unread || b.lastAt - a.lastAt)
    .slice(0, 8);

  const important = usefulMessages
    .filter((message) => hasAnyKeyword(message.content, IMPORTANT_KEYWORDS))
    .slice(0, 8);
  const todos = usefulMessages
    .filter((message) => message.sender === 'them' && hasAnyKeyword(message.content, TODO_KEYWORDS))
    .slice(0, 8)
    .map((message) => ({
      text: cleanMessage(message.content),
      display: message.display,
      ts: message.ts,
      confidence: hasAnyKeyword(message.content, ['需要', '麻烦', '帮我', '记得', '确认'])
        ? 'high' as const
        : 'medium' as const,
    }));

  const questions = receivedToday
    .filter((message) => /[?？吗呢]($|[。！？\s])/.test(message.content))
    .slice(0, 5);
  const keywordTrends = TREND_KEYWORDS.map((keyword) => ({
    keyword,
    count: usefulMessages.reduce((count, message) => (
      message.content.toLowerCase().includes(keyword.toLowerCase()) ? count + 1 : count
    ), 0),
  }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const contentInsights = buildContentInsights(usefulMessages, topConversations);

  const highlights: WeChatAssistantAnalysis['highlights'] = [];
  for (const message of important.slice(0, 5)) {
    highlights.push({
      title: message.display,
      description: cleanMessage(message.content),
      tone: hasAnyKeyword(message.content, ['紧急', '马上', '投诉', '风险', 'deadline', 'asap'])
        ? 'danger'
        : 'warning',
      wxid: message.wxid,
      display: message.display,
      ts: message.ts,
    });
  }
  for (const message of questions.slice(0, Math.max(0, 5 - highlights.length))) {
    highlights.push({
      title: `可能需要回复：${message.display}`,
      description: cleanMessage(message.content),
      tone: 'default',
      wxid: message.wxid,
      display: message.display,
      ts: message.ts,
    });
  }
  if (highlights.length === 0 && usefulMessages.length > 0) {
    const latest = usefulMessages[0];
    highlights.push({
      title: '最近消息',
      description: cleanMessage(latest.content),
      tone: 'success',
      wxid: latest.wxid,
      display: latest.display,
      ts: latest.ts,
    });
  }

  return {
    generatedAt: now,
    summary: buildSummary({
      sessions: snapshot.sessionsScanned,
      messages: snapshot.messagesScanned,
      today: todayMessages.length,
      unreadSessions,
      important: important.length,
      todos: todos.length,
      top: topConversations[0]?.display,
    }),
    source: {
      scope: snapshot.scanScope === 'all_readable_wechat_messages'
        ? '本机微信可读取消息'
        : '本机微信最近会话',
      sessionsScanned: snapshot.sessionsScanned,
      messagesScanned: snapshot.messagesScanned,
      totalReadableMessages: snapshot.totalReadableMessages,
      selectedReadableMessages: snapshot.selectedReadableMessages,
      messagesTruncated: snapshot.messagesTruncated,
      scanScope: snapshot.scanScope,
      safetyLimit: snapshot.safetyLimit,
      todayMessages: todayMessages.length,
      unreadSessions,
    },
    metrics: [
      { label: '扫描会话', value: String(snapshot.sessionsScanned), detail: '本机可读取会话' },
      {
        label: '分析消息',
        value: String(snapshot.messagesScanned),
        detail: snapshot.messagesTruncated
          ? `达到安全上限 ${snapshot.safetyLimit} 条`
          : '已覆盖可读取消息',
      },
      { label: '今日消息', value: String(todayMessages.length), detail: '按本机时区统计' },
      { label: '未读会话', value: String(unreadSessions), detail: '来自微信会话状态' },
    ],
    highlights,
    todos,
    topConversations,
    keywordTrends,
    contentInsights,
    portrait: buildWeChatPortrait(snapshot),
  };
}

function buildSummary(input: {
  sessions: number;
  messages: number;
  today: number;
  unreadSessions: number;
  important: number;
  todos: number;
  top?: string;
}): string {
  if (input.messages === 0) {
    return '还没有读取到可分析的微信消息。请先在“数据授权”里完成初始化，或确认本机微信有聊天记录。';
  }
  const parts = [
    `已读取 ${input.sessions} 个会话、${input.messages} 条消息`,
    `今天新增 ${input.today} 条`,
  ];
  if (input.top) parts.push(`最活跃的是「${input.top}」`);
  if (input.important > 0) parts.push(`发现 ${input.important} 条重要消息`);
  if (input.todos > 0) parts.push(`提取到 ${input.todos} 个可能待办`);
  if (input.unreadSessions > 0) parts.push(`${input.unreadSessions} 个会话仍有未读`);
  return `${parts.join('，')}。`;
}

function buildContentInsights(
  messages: WeChatSnapshotMessage[],
  topConversations: WeChatAssistantAnalysis['topConversations'],
): WeChatAssistantAnalysis['contentInsights'] {
  const textMessages = messages.filter(isContentTextMessage);
  const conversationSignals = buildConversationSignals(textMessages);
  const topics = CONTENT_THEMES.map((theme) => buildContentTopic(theme, textMessages))
    .filter((topic): topic is WeChatContentTopic => topic !== null)
    .sort((a, b) => b.score - a.score || b.conversationCount - a.conversationCount)
    .slice(0, 6);
  return {
    summary: buildContentInsightSummary(topics, textMessages.length),
    topics,
    relationshipSignals: buildRelationshipSignals(conversationSignals, topConversations),
    drafts: buildContentDrafts(topics),
    channelSuggestions: buildChannelSuggestions(topics),
  };
}

function buildContentTopic(
  theme: ContentTheme,
  messages: WeChatSnapshotMessage[],
): WeChatContentTopic | null {
  const evidence = messages.filter((message) => hasAnyKeyword(message.content, theme.keywords));
  if (evidence.length === 0) return null;

  const sources = new Map<string, WeChatContentTopic['sources'][number]>();
  for (const message of evidence) {
    const current = sources.get(message.wxid) ?? {
      wxid: message.wxid,
      display: message.display,
      count: 0,
      isGroup: message.isGroup,
      firstAt: message.ts,
      lastAt: 0,
    };
    current.count += 1;
    current.firstAt = Math.min(current.firstAt, message.ts);
    current.lastAt = Math.max(current.lastAt, message.ts);
    sources.set(message.wxid, current);
  }

  const sourceList = Array.from(sources.values())
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, 4);
  const conversationCount = sources.size;
  const groupCount = Array.from(sources.values()).filter((source) => source.isGroup).length;
  const contactCount = Math.max(0, conversationCount - groupCount);
  const questionCount = evidence.filter((message) => isQuestionLike(message.content)).length;
  const tensionCount = evidence.filter((message) => hasAnyKeyword(message.content, TENSION_KEYWORDS)).length;
  const recentStart = startOfTodaySeconds() - 6 * 24 * 60 * 60;
  const recentCount = evidence.filter((message) => message.ts >= recentStart).length;
  const interestProfile = describeInterestProfile(theme, evidence, questionCount, tensionCount);
  const score = scoreContentTopic({
    messageCount: evidence.length,
    conversationCount,
    groupCount,
    questionCount,
    tensionCount,
    recentCount,
  });
  const spreadProfile = describeSpreadProfile(sourceList, groupCount, contactCount);

  if (score < 35 && evidence.length < 2) return null;

  return {
    id: theme.id,
    title: `高频话题：${theme.label}`,
    theme: theme.label,
    angle: theme.angle,
    format: theme.format,
    score,
    reason: buildTopicReason({
      messageCount: evidence.length,
      conversationCount,
      groupCount,
      contactCount,
      questionCount,
      tensionCount,
    }),
    interestLabel: interestProfile.label,
    interestReason: interestProfile.reason,
    spreadLabel: spreadProfile.label,
    spreadNarrative: spreadProfile.narrative,
    messageCount: evidence.length,
    conversationCount,
    groupCount,
    contactCount,
    tags: theme.tags,
    examples: evidence.slice(0, 3).map((message) => ({
      display: message.display,
      ts: message.ts,
      text: cleanMessage(message.content),
    })),
    sources: sourceList,
  };
}

function buildConversationSignals(messages: WeChatSnapshotMessage[]): ConversationSignal[] {
  const byConversation = new Map<string, ConversationSignal>();
  for (const message of messages) {
    const current = byConversation.get(message.wxid) ?? {
      wxid: message.wxid,
      display: message.display,
      isGroup: message.isGroup,
      count: 0,
      incoming: 0,
      questionCount: 0,
      requestCount: 0,
      firstAt: message.ts,
      lastAt: 0,
    };
    current.count += 1;
    current.incoming += message.sender === 'them' ? 1 : 0;
    current.questionCount += isQuestionLike(message.content) ? 1 : 0;
    current.requestCount += hasAnyKeyword(message.content, TODO_KEYWORDS) ? 1 : 0;
    current.firstAt = Math.min(current.firstAt, message.ts);
    current.lastAt = Math.max(current.lastAt, message.ts);
    byConversation.set(message.wxid, current);
  }
  return Array.from(byConversation.values());
}

function buildRelationshipSignals(
  signals: ConversationSignal[],
  topConversations: WeChatAssistantAnalysis['topConversations'],
): WeChatRelationshipSignal[] {
  const coreContacts = signals
    .filter((item) => !item.isGroup)
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, 4);
  const groupHotspots = signals
    .filter((item) => item.isGroup)
    .sort((a, b) => b.count - a.count || b.questionCount - a.questionCount)
    .slice(0, 4);
  const questionSources = signals
    .filter((item) => item.questionCount > 0 || item.requestCount > 0)
    .sort((a, b) => (b.questionCount + b.requestCount) - (a.questionCount + a.requestCount))
    .slice(0, 4);

  const fallbackGroups = topConversations
    .filter((item) => item.isGroup)
    .slice(0, 4)
    .map(toSignalContact);
  const fallbackContacts = topConversations
    .filter((item) => !item.isGroup)
    .slice(0, 4)
    .map(toSignalContact);

  return [
    {
      label: '核心关系素材池',
      description: '高频单聊通常代表真实需求和真实信任，是最适合提炼故事与痛点的来源。',
      value: `${sumCounts(coreContacts.length ? coreContacts : fallbackContacts)} 条`,
      contacts: (coreContacts.length ? coreContacts : fallbackContacts).map(toSignalContact),
    },
    {
      label: '群聊传播测试场',
      description: '群聊里反复出现的话题更接近公开讨论场，适合判断一个选题有没有外溢传播可能。',
      value: `${sumCounts(groupHotspots.length ? groupHotspots : fallbackGroups)} 条`,
      contacts: (groupHotspots.length ? groupHotspots : fallbackGroups).map(toSignalContact),
    },
    {
      label: '高频问题来源',
      description: '问题和求助越集中，越适合做成问答、避坑、清单或短视频口播。',
      value: `${sumCounts(questionSources)} 条`,
      contacts: questionSources.map(toSignalContact),
    },
  ].filter((item) => item.contacts.length > 0);
}

function describeSpreadProfile(
  sources: WeChatContentTopic['sources'],
  groupCount: number,
  contactCount: number,
): { label: string; narrative: string } {
  if (sources.length === 0) {
    return {
      label: '没有形成传播链',
      narrative: '还没有稳定的跨关系扩散迹象，适合作为待观察素材。',
    };
  }
  const firstSource = sources
    .slice()
    .sort((a, b) => a.firstAt - b.firstAt || b.count - a.count)[0];
  const lastSource = sources
    .slice()
    .sort((a, b) => b.lastAt - a.lastAt || b.count - a.count)[0];
  const chainDays = Math.max(1, Math.ceil((lastSource.lastAt - firstSource.firstAt) / (24 * 60 * 60)));
  const groupPart = groupCount > 0 ? `群聊占 ${groupCount} 个` : '未进入群聊发酵';
  const contactPart = contactCount > 0 ? `单聊先冒头后再扩散到 ${contactCount} 个联系人` : '主要在群聊里讨论';
  if (groupCount >= 2 || (groupCount >= 1 && contactCount >= 1)) {
    return {
      label: '已形成跨关系传播',
      narrative: `${groupPart}，${contactPart}，从最早出现到最近持续约 ${chainDays} 天，适合做更接近真实讨论链路的选题。`,
    };
  }
  if (contactCount >= 2) {
    return {
      label: '先在单聊里发酵',
      narrative: `主要从单聊开始流转，${contactPart}，之后才慢慢被更多关系接住，适合整理成“从个人需求到公共问题”的内容。`,
    };
  }
  return {
    label: '局部热点',
    narrative: `${groupPart}，${contactPart}，目前还像局部讨论，但已经足够作为草稿素材。`,
  };
}

function describeInterestProfile(
  theme: ContentTheme,
  evidence: WeChatSnapshotMessage[],
  questionCount: number,
  tensionCount: number,
): { label: string; reason: string } {
  const sample = evidence[0] ? cleanMessage(evidence[0].content) : '';
  if (tensionCount > 0 && questionCount > 0) {
    return {
      label: '有痛点也有疑问',
      reason: `既有人表达卡点，也有人直接提问，适合做成“问题怎么解决”的内容。代表片段：${sample}`,
    };
  }
  if (tensionCount > 0) {
    return {
      label: '有情绪和冲突',
      reason: `聊天里出现风险、卡住、投诉或紧急表达，说明这个主题天然带冲突和共鸣。代表片段：${sample}`,
    };
  }
  if (questionCount > 0) {
    return {
      label: '有人主动求解',
      reason: `这个主题已经被关系圈主动问起，适合做问答、教程、清单或口播。代表片段：${sample}`,
    };
  }
  if (theme.id === 'trend') {
    return {
      label: '有新鲜变化',
      reason: `关系圈开始讨论最近变化，适合做“为什么大家突然关心它”的趋势观察。代表片段：${sample}`,
    };
  }
  if (theme.id === 'knowledge') {
    return {
      label: '可沉淀资料',
      reason: `有人反复要资料、方法或案例，适合整理成可收藏、可转发的内容。代表片段：${sample}`,
    };
  }
  return {
    label: '高频真实场景',
    reason: `它来自多个真实会话，不是凭空想选题，适合先改写成更普遍的场景。代表片段：${sample}`,
  };
}

function buildContentDrafts(topics: WeChatContentTopic[]): WeChatContentDraft[] {
  return topics.slice(0, 3).map((topic) => ({
    title: draftTitleForTopic(topic),
    hook: `最近微信里有 ${topic.conversationCount} 个会话反复出现「${topic.theme}」，其中 ${topic.groupCount} 个来自群聊。`,
    format: topic.format,
    outline: [
      `现象：${topic.reason}`,
      `切口：${topic.angle}`,
      `素材：优先参考 ${topic.sources.slice(0, 2).map((source) => `「${source.display}」`).join('、') || '最近高频会话'} 的共性表达。`,
      '收尾：用一个可互动的问题引导读者补充自己的类似经历。',
    ],
    sourceTopic: topic.title,
    privacyNote: '发布前请隐去姓名、公司、金额、订单号和聊天原文，只保留抽象观点或改写后的场景。',
  }));
}

function buildChannelSuggestions(topics: WeChatContentTopic[]): WeChatChannelSuggestion[] {
  const topTopics = topics.slice(0, 4);
  if (topTopics.length === 0) return [];
  const strongest = topTopics[0];
  const emotional = topTopics.find((topic) => /痛点|情绪|冲突|求解/.test(topic.interestLabel)) ?? strongest;
  const crossRelation = topTopics.find((topic) => topic.spreadLabel === '已形成跨关系传播') ?? strongest;
  const knowledge = topTopics.find((topic) => topic.id === 'knowledge' || topic.format === '资料包') ?? strongest;

  return [
    {
      channel: '朋友圈',
      title: `朋友圈短帖：${emotional.theme}`,
      fit: `适合先用一个真实但脱敏的小场景试水，因为它的亮点是「${emotional.interestLabel}」。`,
      nextAction: '把原始片段改写成 3 句话：场景、反差、一个提问，末尾引导朋友补充经历。',
      sourceTopic: emotional.title,
    },
    {
      channel: '公众号',
      title: `公众号长文：${knowledge.theme}`,
      fit: `适合沉淀成结构化内容，当前建议形式是「${knowledge.format}」。`,
      nextAction: '按“现象 -> 原因 -> 案例 -> 方法 -> 清单”扩写，全文避免出现聊天原文和具体身份。',
      sourceTopic: knowledge.title,
    },
    {
      channel: '短视频',
      title: `短视频口播：${crossRelation.theme}`,
      fit: `适合做成观点口播，因为它的传播路径是「${crossRelation.spreadLabel}」。`,
      nextAction: '用 5 秒问题开头，30 秒讲一个脱敏场景，最后给一个可操作建议。',
      sourceTopic: crossRelation.title,
    },
    {
      channel: '选题库',
      title: '待观察选题池',
      fit: `当前已有 ${topTopics.length} 个候选方向，适合继续按关系圈层观察热度变化。`,
      nextAction: '保留话题名、关系来源、代表片段和下次观察时间，后续再决定是否正式发布。',
      sourceTopic: strongest.title,
    },
  ];
}

function buildContentInsightSummary(topics: WeChatContentTopic[], messageCount: number): string {
  if (messageCount === 0) {
    return '当前可分析文本太少，还没有形成稳定的话题素材。';
  }
  if (topics.length === 0) {
    return `已读取 ${messageCount} 条可分析文本，但暂未发现明显可传播主题。可以先扩大消息范围或沉淀更多聊天记录。`;
  }
  const top = topics[0];
  return `从 ${messageCount} 条可分析文本里发现 ${topics.length} 个内容方向，当前最值得先看的主题是「${top.theme}」，传播潜力 ${top.score}/100。`;
}

function buildTopicReason(input: {
  messageCount: number;
  conversationCount: number;
  groupCount: number;
  contactCount: number;
  questionCount: number;
  tensionCount: number;
}): string {
  const sourceParts = [
    `${input.messageCount} 条相关消息`,
    `${input.conversationCount} 个会话`,
  ];
  if (input.groupCount > 0) sourceParts.push(`${input.groupCount} 个群聊`);
  if (input.contactCount > 0) sourceParts.push(`${input.contactCount} 个单聊`);
  const signalParts = [];
  if (input.questionCount > 0) signalParts.push(`${input.questionCount} 条问题/求助`);
  if (input.tensionCount > 0) signalParts.push(`${input.tensionCount} 条紧张或痛点表达`);
  return signalParts.length
    ? `${sourceParts.join('，')}；其中 ${signalParts.join('，')}，适合提炼成有共鸣的内容。`
    : `${sourceParts.join('，')}，适合先作为选题线索继续观察。`;
}

function scoreContentTopic(input: {
  messageCount: number;
  conversationCount: number;
  groupCount: number;
  questionCount: number;
  tensionCount: number;
  recentCount: number;
}): number {
  const score = 18
    + Math.min(input.messageCount * 4, 24)
    + Math.min(input.conversationCount * 9, 27)
    + Math.min(input.groupCount * 8, 16)
    + Math.min(input.questionCount * 4, 12)
    + Math.min(input.tensionCount * 3, 9)
    + Math.min(input.recentCount * 2, 8);
  return Math.min(100, Math.round(score));
}

function draftTitleForTopic(topic: WeChatContentTopic): string {
  switch (topic.id) {
    case 'decision':
      return '为什么很多沟通卡住，不是没人做，而是没人确认下一步';
    case 'money':
      return '一次付款/报价沟通里，最容易被忽略的信任细节';
    case 'problem':
      return '大家反复吐槽的那个问题，其实是一个选题入口';
    case 'followup':
      return '微信里最常见的待办，暴露了真实需求';
    case 'knowledge':
      return '别人反复向你要资料，说明这件事值得做成内容';
    case 'trend':
      return '关系圈里突然被提起的新变化，可能就是下一个话题';
    default:
      return `把「${topic.theme}」整理成一条可传播内容`;
  }
}

function toSignalContact(item: {
  wxid: string;
  display: string;
  count: number;
  isGroup: boolean;
  firstAt?: number;
  lastAt: number;
}): WeChatRelationshipSignal['contacts'][number] {
  return {
    wxid: item.wxid,
    display: item.display,
    count: item.count,
    isGroup: item.isGroup,
    firstAt: item.firstAt ?? item.lastAt,
    lastAt: item.lastAt,
  };
}

function sumCounts(items: Array<{ count: number }>): number {
  return items.reduce((sum, item) => sum + item.count, 0);
}

function startOfTodaySeconds(): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function hasAnyKeyword(content: string, keywords: string[]): boolean {
  const lower = content.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function isQuestionLike(content: string): boolean {
  return hasAnyKeyword(content, QUESTION_KEYWORDS);
}

function isContentTextMessage(message: WeChatSnapshotMessage): boolean {
  const normalized = cleanMessage(message.content);
  return normalized.length >= 4 && !/^\[[^\]]+\]$/.test(normalized);
}

function cleanMessage(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
}

function sanitizeSnapshotSession(session: WeChatSnapshotSession): WeChatSnapshotSession {
  return {
    ...session,
    display: displayChatName(session.display, session.wxid),
  };
}

function sanitizeSnapshotMessage(message: WeChatSnapshotMessage): WeChatSnapshotMessage {
  return {
    ...message,
    display: displayChatName(message.display, message.wxid),
    content: safeSanitizedWechatText(message.content, ''),
  };
}

function displayChatName(display: string | null | undefined, wxid: string): string {
  return displayWechatName(display, wxid, {
    groupFallback: '微信群聊',
    contactFallback: '微信联系人',
  });
}
