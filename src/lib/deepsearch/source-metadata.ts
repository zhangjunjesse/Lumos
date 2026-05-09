export type DeepSearchSourceStatus = 'implemented' | 'validated_candidate' | 'candidate';

export type DeepSearchSourceFamily =
  | 'social_web'
  | 'open_books'
  | 'open_papers'
  | 'ancient_texts'
  | 'discovery_index'
  | 'library_repository';

export type DeepSearchSourceContentType =
  | 'qa_article'
  | 'social_post'
  | 'book'
  | 'ancient_book'
  | 'journal_article'
  | 'preprint'
  | 'thesis'
  | 'patent'
  | 'dataset'
  | 'bibliographic_record';

export type DeepSearchSourceAccessMode =
  | 'browser_adapter'
  | 'public_api'
  | 'official_export'
  | 'oai_pmh'
  | 'bulk_dump'
  | 'html_reading'
  | 'pdf_download'
  | 'scan_reading'
  | 'hybrid';

export type DeepSearchSourceFullContentAvailability =
  | 'full_machine_text'
  | 'full_scan'
  | 'mixed'
  | 'search_and_linkout'
  | 'metadata_only';

export type DeepSearchSourceAuthRequirement =
  | 'none'
  | 'optional'
  | 'registration'
  | 'api_key'
  | 'institutional'
  | 'mixed';

export type DeepSearchSourceRiskLevel = 'low' | 'medium' | 'high';
export type DeepSearchSourceQuality = 'low' | 'medium' | 'high';
export type DeepSearchSourceRole = 'fulltext' | 'discovery' | 'hybrid';
export type DeepSearchSourceLiveVerifiedScope =
  | 'full_content'
  | 'search_and_metadata'
  | 'site_access_only'
  | 'access_denied'
  | 'rate_limited'
  | 'none';

export interface DeepSearchSourceMetadata {
  id: string;
  displayName: string;
  status: DeepSearchSourceStatus;
  family: DeepSearchSourceFamily;
  primaryLanguages: string[];
  contentTypes: DeepSearchSourceContentType[];
  fullContentAvailability: DeepSearchSourceFullContentAvailability;
  accessModes: DeepSearchSourceAccessMode[];
  authRequirement: DeepSearchSourceAuthRequirement;
  antiBotRisk: DeepSearchSourceRiskLevel;
  metadataQuality: DeepSearchSourceQuality;
  contentQuality: DeepSearchSourceQuality;
  recommendedRole: DeepSearchSourceRole;
  supportsStructuredMetadata: boolean;
  supportsBulkAccess: boolean;
  liveVerified: boolean;
  liveVerifiedScope: DeepSearchSourceLiveVerifiedScope;
  officialUrl: string;
  notes: string;
  validationNotes: string;
}

export const DEEPSEARCH_SOURCE_REGISTRY: DeepSearchSourceMetadata[] = [
  {
    id: 'zhihu',
    displayName: '知乎',
    status: 'implemented',
    family: 'social_web',
    primaryLanguages: ['zh'],
    contentTypes: ['qa_article', 'journal_article'],
    fullContentAvailability: 'mixed',
    accessModes: ['browser_adapter', 'html_reading'],
    authRequirement: 'optional',
    antiBotRisk: 'high',
    metadataQuality: 'medium',
    contentQuality: 'medium',
    recommendedRole: 'fulltext',
    supportsStructuredMetadata: true,
    supportsBulkAccess: false,
    liveVerified: false,
    liveVerifiedScope: 'none',
    officialUrl: 'https://www.zhihu.com/',
    notes: '已纳入 DeepSearch 当前站点适配器。适合问答和专栏正文抓取，不适合做图书/论文主源。',
    validationNotes: '当前是运行时已接入站点，不属于这轮开放图书/论文源 live 验证范围。',
  },
  {
    id: 'wechat',
    displayName: '微信公众号',
    status: 'implemented',
    family: 'social_web',
    primaryLanguages: ['zh'],
    contentTypes: ['qa_article'],
    fullContentAvailability: 'mixed',
    accessModes: ['browser_adapter', 'html_reading'],
    authRequirement: 'optional',
    antiBotRisk: 'high',
    metadataQuality: 'low',
    contentQuality: 'medium',
    recommendedRole: 'fulltext',
    supportsStructuredMetadata: false,
    supportsBulkAccess: false,
    liveVerified: false,
    liveVerifiedScope: 'none',
    officialUrl: 'https://mp.weixin.qq.com/',
    notes: '已纳入 DeepSearch 当前站点适配器。适合单篇文章抓取，不适合做稳定学术元数据源。',
    validationNotes: '当前是运行时已接入站点，不属于这轮开放图书/论文源 live 验证范围。',
  },
  {
    id: 'xiaohongshu',
    displayName: '小红书',
    status: 'implemented',
    family: 'social_web',
    primaryLanguages: ['zh'],
    contentTypes: ['social_post'],
    fullContentAvailability: 'mixed',
    accessModes: ['browser_adapter', 'html_reading'],
    authRequirement: 'optional',
    antiBotRisk: 'high',
    metadataQuality: 'low',
    contentQuality: 'low',
    recommendedRole: 'fulltext',
    supportsStructuredMetadata: false,
    supportsBulkAccess: false,
    liveVerified: false,
    liveVerifiedScope: 'none',
    officialUrl: 'https://www.xiaohongshu.com/',
    notes: '已纳入 DeepSearch 当前站点适配器。适合经验帖，不适合做正式图书/论文知识库主源。',
    validationNotes: '当前是运行时已接入站点，不属于这轮开放图书/论文源 live 验证范围。',
  },
  {
    id: 'x',
    displayName: 'X (Twitter)',
    status: 'implemented',
    family: 'social_web',
    primaryLanguages: ['en', 'multilingual'],
    contentTypes: ['social_post'],
    fullContentAvailability: 'mixed',
    accessModes: ['browser_adapter', 'public_api'],
    authRequirement: 'registration',
    antiBotRisk: 'high',
    metadataQuality: 'medium',
    contentQuality: 'low',
    recommendedRole: 'fulltext',
    supportsStructuredMetadata: true,
    supportsBulkAccess: false,
    liveVerified: false,
    liveVerifiedScope: 'none',
    officialUrl: 'https://x.com/',
    notes: '需先在「服务 → X」登录,基于 @the-convocation/twitter-scraper 搜索 + 用户/推文详情。适合时事/短文,不适合长文知识库。',
    validationNotes: '失效时排查 src/lib/x-platform/scraper.ts (Scraper 单例 + cookie 注入)；scraper 包内部维护 transaction-id / x-csrf-token,不再依赖手维护 GraphQL queryId。',
  },
  {
    id: 'project_gutenberg',
    displayName: 'Project Gutenberg',
    status: 'implemented',
    family: 'open_books',
    primaryLanguages: ['en', 'multilingual'],
    contentTypes: ['book'],
    fullContentAvailability: 'full_machine_text',
    accessModes: ['public_api', 'official_export', 'bulk_dump'],
    authRequirement: 'none',
    antiBotRisk: 'low',
    metadataQuality: 'medium',
    contentQuality: 'high',
    recommendedRole: 'fulltext',
    supportsStructuredMetadata: true,
    supportsBulkAccess: true,
    liveVerified: true,
    liveVerifiedScope: 'full_content',
    officialUrl: 'https://www.gutenberg.org/',
    notes: '公共领域图书主源。当前已接入 DeepSearch adapter，搜索走官方 OPDS，正文优先走官方 plain-text 下载链路。',
    validationNotes: '已用验证脚本直接获取 TXT 全文；当前仓库已补上 `project_gutenberg` adapter 原型。',
  },
  {
    id: 'wikisource_zh',
    displayName: '中文维基文库',
    status: 'implemented',
    family: 'open_books',
    primaryLanguages: ['zh'],
    contentTypes: ['book', 'ancient_book'],
    fullContentAvailability: 'full_machine_text',
    accessModes: ['public_api', 'official_export', 'html_reading'],
    authRequirement: 'none',
    antiBotRisk: 'low',
    metadataQuality: 'medium',
    contentQuality: 'high',
    recommendedRole: 'fulltext',
    supportsStructuredMetadata: true,
    supportsBulkAccess: true,
    liveVerified: true,
    liveVerifiedScope: 'full_content',
    officialUrl: 'https://zh.wikisource.org/',
    notes: '中文公共领域文本主源。适合古籍、旧文献、经典文本，现已接入 DeepSearch 站点 adapter。',
    validationNotes: '已用 MediaWiki API 对《史记》做 live 验证，能直接拿到机器可读正文；当前仓库已补上 `wikisource_zh` adapter 原型。',
  },
  {
    id: 'wikisource_en',
    displayName: '英文维基文库',
    status: 'validated_candidate',
    family: 'open_books',
    primaryLanguages: ['en'],
    contentTypes: ['book'],
    fullContentAvailability: 'full_machine_text',
    accessModes: ['public_api', 'official_export', 'html_reading'],
    authRequirement: 'none',
    antiBotRisk: 'low',
    metadataQuality: 'medium',
    contentQuality: 'high',
    recommendedRole: 'fulltext',
    supportsStructuredMetadata: true,
    supportsBulkAccess: true,
    liveVerified: true,
    liveVerifiedScope: 'full_content',
    officialUrl: 'https://en.wikisource.org/',
    notes: '英文公共领域文本主源。已在本机验证过 MediaWiki API 正文读取。',
    validationNotes: '已用 MediaWiki API 读取 Pride and Prejudice 页面正文。',
  },
  {
    id: 'pmc_bioc',
    displayName: 'PMC Open Access / BioC',
    status: 'implemented',
    family: 'open_papers',
    primaryLanguages: ['en'],
    contentTypes: ['journal_article'],
    fullContentAvailability: 'full_machine_text',
    accessModes: ['public_api', 'oai_pmh', 'official_export', 'bulk_dump'],
    authRequirement: 'none',
    antiBotRisk: 'low',
    metadataQuality: 'high',
    contentQuality: 'high',
    recommendedRole: 'fulltext',
    supportsStructuredMetadata: true,
    supportsBulkAccess: true,
    liveVerified: true,
    liveVerifiedScope: 'full_content',
    officialUrl: 'https://pmc.ncbi.nlm.nih.gov/tools/openftlist/',
    notes: '生命科学高质量全文源。当前已接入 DeepSearch adapter，搜索复用 Europe PMC，正文优先走官方 BioC JSON。',
    validationNotes: '已用官方 BioC API 获取结构化全文 JSON；当前仓库已补上 `pmc_bioc` adapter 原型。',
  },
  {
    id: 'europe_pmc',
    displayName: 'Europe PMC',
    status: 'implemented',
    family: 'open_papers',
    primaryLanguages: ['en'],
    contentTypes: ['journal_article', 'preprint'],
    fullContentAvailability: 'search_and_linkout',
    accessModes: ['public_api'],
    authRequirement: 'none',
    antiBotRisk: 'low',
    metadataQuality: 'high',
    contentQuality: 'high',
    recommendedRole: 'discovery',
    supportsStructuredMetadata: true,
    supportsBulkAccess: false,
    liveVerified: true,
    liveVerifiedScope: 'search_and_metadata',
    officialUrl: 'https://europepmc.org/',
    notes: '适合作为生命科学论文搜索与开放全文入口。当前已接入 DeepSearch adapter，搜索走官方 REST API，正文优先走官方 fullTextXML，失败时回退到摘要。',
    validationNotes: '已验证搜索、摘要和全文链接字段；当前仓库已补上 `europe_pmc` adapter 原型。',
  },
  {
    id: 'arxiv',
    displayName: 'arXiv',
    status: 'validated_candidate',
    family: 'open_papers',
    primaryLanguages: ['en'],
    contentTypes: ['preprint'],
    fullContentAvailability: 'mixed',
    accessModes: ['public_api', 'oai_pmh', 'bulk_dump', 'pdf_download'],
    authRequirement: 'none',
    antiBotRisk: 'medium',
    metadataQuality: 'high',
    contentQuality: 'medium',
    recommendedRole: 'hybrid',
    supportsStructuredMetadata: true,
    supportsBulkAccess: true,
    liveVerified: true,
    liveVerifiedScope: 'rate_limited',
    officialUrl: 'https://arxiv.org/',
    notes: '适合 AI/CS/Math/Physics 预印本。当前机器调用官方 API 命中 429，接入时必须带节流和备用抓取策略。',
    validationNotes: '已实测触达官方 API，但当前机器/IP 返回 429，尚未在本机完成稳定正文或 metadata 拉取。',
  },
  {
    id: 'open_library',
    displayName: 'Open Library',
    status: 'validated_candidate',
    family: 'discovery_index',
    primaryLanguages: ['en', 'multilingual'],
    contentTypes: ['book', 'bibliographic_record'],
    fullContentAvailability: 'search_and_linkout',
    accessModes: ['public_api', 'bulk_dump'],
    authRequirement: 'none',
    antiBotRisk: 'low',
    metadataQuality: 'high',
    contentQuality: 'medium',
    recommendedRole: 'discovery',
    supportsStructuredMetadata: true,
    supportsBulkAccess: true,
    liveVerified: true,
    liveVerifiedScope: 'search_and_metadata',
    officialUrl: 'https://openlibrary.org/',
    notes: '适合作为图书发现层，不是第一阶段全文主源。已在本机验证搜索与 fulltext 指示字段。',
    validationNotes: '已验证搜索结果、IA 标识和 fulltext/public scan 指示字段。',
  },
  {
    id: 'openalex',
    displayName: 'OpenAlex',
    status: 'candidate',
    family: 'discovery_index',
    primaryLanguages: ['en', 'multilingual'],
    contentTypes: ['journal_article', 'book', 'dataset', 'bibliographic_record'],
    fullContentAvailability: 'search_and_linkout',
    accessModes: ['public_api', 'official_export', 'bulk_dump'],
    authRequirement: 'api_key',
    antiBotRisk: 'low',
    metadataQuality: 'high',
    contentQuality: 'high',
    recommendedRole: 'discovery',
    supportsStructuredMetadata: true,
    supportsBulkAccess: true,
    liveVerified: false,
    liveVerifiedScope: 'none',
    officialUrl: 'https://openalex.org/',
    notes: '学术统一发现层，适合做 DOI/实体归一和内容定位。当前仓库尚未配置 API key。',
    validationNotes: '仅完成官方文档确认，当前未配置 API key，因此未做 live 验证。',
  },
  {
    id: 'core',
    displayName: 'CORE',
    status: 'candidate',
    family: 'open_papers',
    primaryLanguages: ['en', 'multilingual'],
    contentTypes: ['journal_article', 'thesis'],
    fullContentAvailability: 'mixed',
    accessModes: ['public_api', 'official_export', 'bulk_dump'],
    authRequirement: 'api_key',
    antiBotRisk: 'low',
    metadataQuality: 'high',
    contentQuality: 'medium',
    recommendedRole: 'hybrid',
    supportsStructuredMetadata: true,
    supportsBulkAccess: true,
    liveVerified: false,
    liveVerifiedScope: 'none',
    officialUrl: 'https://core.ac.uk/',
    notes: '开放获取论文聚合器，适合二期通用论文入口。当前仓库尚未配置 API key。',
    validationNotes: '仅完成官方文档确认，当前未配置 API key，因此未做 live 验证。',
  },
  {
    id: 'ncpssd',
    displayName: '国家哲学社会科学文献中心',
    status: 'candidate',
    family: 'library_repository',
    primaryLanguages: ['zh', 'en'],
    contentTypes: ['journal_article', 'ancient_book', 'book'],
    fullContentAvailability: 'mixed',
    accessModes: ['html_reading', 'pdf_download', 'hybrid'],
    authRequirement: 'registration',
    antiBotRisk: 'medium',
    metadataQuality: 'high',
    contentQuality: 'high',
    recommendedRole: 'hybrid',
    supportsStructuredMetadata: false,
    supportsBulkAccess: false,
    liveVerified: true,
    liveVerifiedScope: 'search_and_metadata',
    officialUrl: 'https://www.ncpssd.cn/',
    notes: '中文社科主源。官方说明注册登录后可使用在线阅读和全文下载。公开 API 未发现，接入更像账号态站点适配。',
    validationNotes: '已实测官方指南和中文期刊资源列表页可访问，页面确认存在在线阅读/全文下载能力；但未实测注册后全文抓取链路。',
  },
  {
    id: 'pubscholar',
    displayName: 'PubScholar 公益学术平台',
    status: 'candidate',
    family: 'library_repository',
    primaryLanguages: ['zh', 'en'],
    contentTypes: ['journal_article', 'thesis', 'preprint', 'patent', 'dataset', 'book'],
    fullContentAvailability: 'mixed',
    accessModes: ['html_reading', 'pdf_download', 'hybrid'],
    authRequirement: 'mixed',
    antiBotRisk: 'medium',
    metadataQuality: 'high',
    contentQuality: 'high',
    recommendedRole: 'hybrid',
    supportsStructuredMetadata: false,
    supportsBulkAccess: false,
    liveVerified: true,
    liveVerifiedScope: 'site_access_only',
    officialUrl: 'https://pubscholar.cn/',
    notes: '中文科技类重要补充源。官方公开介绍强调海量元数据和全文，但当前未找到公开 API 文档，接入可能需要浏览器或私有接口调研。',
    validationNotes: '已实测首页可访问并返回平台介绍，但尚未打通公开检索结果页或全文获取链路。',
  },
  {
    id: 'chinaxiv',
    displayName: 'ChinaXiv',
    status: 'candidate',
    family: 'open_papers',
    primaryLanguages: ['zh', 'en'],
    contentTypes: ['preprint', 'journal_article'],
    fullContentAvailability: 'mixed',
    accessModes: ['html_reading', 'pdf_download', 'oai_pmh'],
    authRequirement: 'optional',
    antiBotRisk: 'low',
    metadataQuality: 'high',
    contentQuality: 'medium',
    recommendedRole: 'hybrid',
    supportsStructuredMetadata: true,
    supportsBulkAccess: true,
    liveVerified: true,
    liveVerifiedScope: 'access_denied',
    officialUrl: 'https://www.chinaxiv.org/',
    notes: '中文科研预印本重要补充源。官方帮助中明确有 OAI-PMH 开放接口；阅读和检索公开，投稿需机构邮箱或认证。',
    validationNotes: '已实测官方首页与 OAI 接口，但当前机器访问 OAI 端点被站点访问控制拦截，未完成正文或元数据抓取。',
  },
  {
    id: 'ctext',
    displayName: 'Chinese Text Project',
    status: 'implemented',
    family: 'ancient_texts',
    primaryLanguages: ['zh', 'en'],
    contentTypes: ['ancient_book'],
    fullContentAvailability: 'mixed',
    accessModes: ['public_api', 'oai_pmh', 'html_reading', 'hybrid'],
    authRequirement: 'mixed',
    antiBotRisk: 'low',
    metadataQuality: 'high',
    contentQuality: 'high',
    recommendedRole: 'hybrid',
    supportsStructuredMetadata: true,
    supportsBulkAccess: true,
    liveVerified: true,
    liveVerifiedScope: 'full_content',
    officialUrl: 'https://ctext.org/',
    notes: '中文古籍和先秦两汉文本的重要机器可读源。当前已接入 DeepSearch adapter，优先走官方 `readlink/gettext`，标题检索走公开书名检索页。',
    validationNotes: '已用公开 API 实测获取《论语·学而》正文内容，当前未登录也可读；当前仓库已补上 `ctext` adapter 原型，但更高级的整书结构能力仍受认证/订阅影响。',
  },
  {
    id: 'nlc_guji',
    displayName: '国家图书馆中华古籍资源库',
    status: 'candidate',
    family: 'ancient_texts',
    primaryLanguages: ['zh'],
    contentTypes: ['ancient_book'],
    fullContentAvailability: 'full_scan',
    accessModes: ['html_reading', 'scan_reading'],
    authRequirement: 'optional',
    antiBotRisk: 'medium',
    metadataQuality: 'high',
    contentQuality: 'high',
    recommendedRole: 'fulltext',
    supportsStructuredMetadata: false,
    supportsBulkAccess: false,
    liveVerified: true,
    liveVerifiedScope: 'search_and_metadata',
    officialUrl: 'https://www.nlc.cn/',
    notes: '中文古籍和地方志的重要官方源。稳定的是影像全文，机器可读正文能力因子库和页面而异。',
    validationNotes: '已实测资源介绍页和 read.nlc.cn 数字古籍列表页，公开可拿到资源条目、标题、责任者和缩略图；未实测单书影像全文抓取。',
  },
  {
    id: 'cadal',
    displayName: 'CADAL 大学数字图书馆国际合作计划',
    status: 'candidate',
    family: 'library_repository',
    primaryLanguages: ['zh', 'en'],
    contentTypes: ['book', 'ancient_book', 'journal_article', 'thesis'],
    fullContentAvailability: 'mixed',
    accessModes: ['html_reading', 'scan_reading', 'hybrid'],
    authRequirement: 'mixed',
    antiBotRisk: 'medium',
    metadataQuality: 'high',
    contentQuality: 'high',
    recommendedRole: 'hybrid',
    supportsStructuredMetadata: false,
    supportsBulkAccess: false,
    liveVerified: true,
    liveVerifiedScope: 'search_and_metadata',
    officialUrl: 'https://cadal.edu.cn/',
    notes: '中文图书和民国文献的重要补充源。公开检索强，但部分资源需要借阅或按章节阅读，不适合作为无认证批量主源。',
    validationNotes: '已实测单书详情页可公开访问并返回资源元数据；页面逻辑明确存在登录、借阅、试读和 7 天阅读时长控制，未完成正文抓取验证。',
  },
];

export function listDeepSearchSources(): DeepSearchSourceMetadata[] {
  return [...DEEPSEARCH_SOURCE_REGISTRY];
}

export function getDeepSearchSourceById(id: string): DeepSearchSourceMetadata | null {
  return DEEPSEARCH_SOURCE_REGISTRY.find((source) => source.id === id) ?? null;
}
