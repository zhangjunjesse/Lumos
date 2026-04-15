# DeepSearch 数据源元数据草案

## 目标

1. 给 DeepSearch 已纳管和候选纳管的数据源建立统一元数据
2. 明确每个源是否能拿到完整内容
3. 明确每个源的接入方式、认证要求和反爬风险
4. 补上中文源不足的问题

## 元数据字段

每个数据源至少要有这些字段：

1. `id`
2. `displayName`
3. `status`
   - `implemented`
   - `validated_candidate`
   - `candidate`
4. `family`
   - `social_web`
   - `open_books`
   - `open_papers`
   - `ancient_texts`
   - `discovery_index`
   - `library_repository`
5. `primaryLanguages`
6. `contentTypes`
7. `fullContentAvailability`
   - `full_machine_text`
   - `full_scan`
   - `mixed`
   - `search_and_linkout`
   - `metadata_only`
8. `accessModes`
9. `authRequirement`
10. `antiBotRisk`
11. `metadataQuality`
12. `contentQuality`
13. `recommendedRole`
14. `supportsStructuredMetadata`
15. `supportsBulkAccess`
16. `officialUrl`
17. `notes`
18. `liveVerified`
19. `liveVerifiedScope`
20. `validationNotes`

这套结构已经落到：

1. [source-metadata.ts](/Users/zhangjun/私藏/lumos/src/lib/deepsearch/source-metadata.ts)

## 验证状态定义

这次我把“有资料依据”和“已经实测抓到内容”分开了：

1. `liveVerified=true + full_content`
   - 代表已经在本机直接抓到可读正文或全文内容
2. `liveVerified=true + search_and_metadata`
   - 代表已经在本机抓到搜索结果、摘要、链接或元数据，但没完成整篇全文验证
3. `liveVerified=true + rate_limited`
   - 代表已经实测连到官方接口，但当前机器命中限流，不能算全文验证通过
4. `liveVerified=true + access_denied`
   - 代表已经实测到站点或接口，但当前机器被站点访问控制拦截
5. `liveVerified=false + site_access_only`
   - 代表只实测了站点或官方指南可访问，没有实测内容抓取
6. `liveVerified=false + none`
   - 代表目前只有官方文档确认，没有做 live 验证

## 当前严格结论

### 已实测能抓到完整内容

1. `Project Gutenberg`
2. `英文维基文库`
3. `中文维基文库`
4. `PMC Open Access / BioC`
5. `Chinese Text Project`

### 已实测能抓到搜索或元数据，但没验证完整全文

1. `Europe PMC`
2. `Open Library`
3. `国家哲学社会科学文献中心`
4. `CADAL`
5. `国家图书馆中华古籍资源库`

### 已实测到官方接口，但当前机器被限流

1. `arXiv`

### 已实测到站点，但目前只确认站点级可达

1. `PubScholar`

### 已实测到站点或接口，但当前机器被站点拦截

1. `ChinaXiv`

### 目前只有文档确认，还没做 live 验证

1. `OpenAlex`
2. `CORE`

## 已纳管源

### 1. 知乎

1. 当前状态：`implemented`
2. 类型：中文问答 / 专栏
3. 完整内容：`mixed`
4. 获取方式：`browser adapter`
5. 认证：`optional`
6. 反爬风险：`high`
7. 用途：抓单篇经验内容，不适合做图书或论文主源

### 2. 微信公众号

1. 当前状态：`implemented`
2. 类型：中文文章
3. 完整内容：`mixed`
4. 获取方式：`browser adapter`
5. 认证：`optional`
6. 反爬风险：`high`
7. 用途：抓单篇文章，不适合做正式学术主源

### 3. 小红书

1. 当前状态：`implemented`
2. 类型：中文社区帖文
3. 完整内容：`mixed`
4. 获取方式：`browser adapter`
5. 认证：`optional`
6. 反爬风险：`high`
7. 用途：抓经验帖，不适合做图书或论文主源

## 已验证的开放源

### 1. Project Gutenberg

1. 当前状态：`validated_candidate`
2. 语言：以英文为主
3. 类型：公共领域图书
4. 完整内容：`full_machine_text`
5. 获取方式：`txt/html/epub + catalog + dump`
6. 认证：`none`
7. 反爬风险：`low`
8. 是否适合 DeepSearch：`非常适合做英文图书全文源`
9. 本机验证：`已成功拿到 TXT 全文`
10. 验证等级：`liveVerified=true / full_content`

官方依据：

1. Gutenberg 文件格式说明  
   <https://dev.gutenberg.org/help/file_formats.html>
2. Gutenberg 离线 catalog  
   <https://www.gutenberg.org/ebooks/offline_catalogs.html>

### 2. 英文 / 中文维基文库

1. 当前状态：`validated_candidate`
2. 语言：`en` / `zh`
3. 类型：公共领域图书、古籍、旧文献
4. 完整内容：`full_machine_text`
5. 获取方式：`MediaWiki API + Export`
6. 认证：`none`
7. 反爬风险：`low`
8. 是否适合 DeepSearch：`适合做公版文本全文源`
9. 本机验证：
   - `英文维基文库`：Pride and Prejudice 正文读取成功
   - `中文维基文库`：`史記` 正文读取成功
10. 验证等级：`liveVerified=true / full_content`

官方依据：

1. MediaWiki Action API  
   <https://www.mediawiki.org/wiki/API:Action_API>
2. MediaWiki Query API  
   <https://www.mediawiki.org/wiki/API:Query>
3. Wikisource WS Export  
   <https://wikisource.org/wiki/Wikisource:WS_Export>

### 3. PMC Open Access / BioC

1. 当前状态：`validated_candidate`
2. 语言：以英文为主
3. 类型：生物医学论文全文
4. 完整内容：`full_machine_text`
5. 获取方式：`BioC API / OA Web Service / OAI-PMH / FTP`
6. 认证：`none`
7. 反爬风险：`low`
8. 是否适合 DeepSearch：`非常适合做高质量论文全文源`
9. 本机验证：`BioC JSON 获取成功`
10. 验证等级：`liveVerified=true / full_content`

官方依据：

1. PMC OA Subset  
   <https://pmc.ncbi.nlm.nih.gov/tools/openftlist/>
2. PMC BioC API  
   <https://www.ncbi.nlm.nih.gov/research/bionlp/APIs/BioC-PMC/>

### 4. Europe PMC

1. 当前状态：`validated_candidate`
2. 语言：以英文为主
3. 类型：生命科学论文搜索和全文链接
4. 完整内容：`search_and_linkout`
5. 获取方式：`REST API`
6. 认证：`none`
7. 反爬风险：`low`
8. 是否适合 DeepSearch：`适合作为论文发现层`
9. 本机验证：`搜索、摘要、全文链接字段成功`
10. 验证等级：`liveVerified=true / search_and_metadata`

官方依据：

1. Europe PMC RESTful Web Service  
   <https://dev.europepmc.org/RestfulWebService>

### 5. Open Library

1. 当前状态：`validated_candidate`
2. 语言：多语言
3. 类型：图书发现、馆藏和版本信息
4. 完整内容：`search_and_linkout`
5. 获取方式：`Web API + dumps`
6. 认证：`none`
7. 反爬风险：`low`
8. 是否适合 DeepSearch：`适合做图书发现层，不是全文主源`
9. 本机验证：`搜索与 fulltext 指示字段成功`
10. 验证等级：`liveVerified=true / search_and_metadata`

官方依据：

1. Open Library API  
   <https://openlibrary.org/developers/api>
2. Open Library Search API  
   <https://openlibrary.org/dev/docs/api/search>

## 需要补入的中文源

### 1. 国家哲学社会科学文献中心

为什么要补：

1. 中文社科资源权威
2. 官方明确包含中文期刊、古籍、外文图书、优先发布论文
3. 官方帮助明确写了注册后可在线阅读和全文下载

元数据判断：

1. 语言：以中文为主
2. 类型：中文期刊、外文期刊、古籍、集刊、外文图书、优先发布论文
3. 完整内容：`mixed`
4. 获取方式：`站内检索 + 在线阅读 + 全文下载`
5. 认证：`registration`
6. 反爬风险：`medium`
7. 推荐角色：`hybrid`
8. DeepSearch 适配建议：`浏览器 / 账号态 adapter`
9. 当前验证等级：`liveVerified=true / search_and_metadata`
10. 当前实测结论：官方帮助页和中文期刊资源页可访问，能确认存在在线阅读/全文下载能力，但还没验证注册后全文抓取。

官方依据：

1. 首页资源类型  
   <https://www.ncpssd.cn/>
2. 使用指南写明“注册登录后使用文献检索、在线阅读、全文下载”  
   <https://www.ncpssd.cn/service/guide>

### 2. PubScholar 公益学术平台

为什么要补：

1. 中文科技资源量大
2. 官方公开介绍包含论文、学位论文、预印本、专利、科学数据和图书专著
3. 适合作为中文科技论文和专著发现层

元数据判断：

1. 语言：中文为主，含外文资源
2. 类型：科技论文、学位论文、预印本、专利、科学数据、图书专著
3. 完整内容：`mixed`
4. 获取方式：`站内检索 + 全文获取导航`
5. 认证：`mixed`
6. 反爬风险：`medium`
7. 推荐角色：`hybrid`
8. DeepSearch 适配建议：`先浏览器 / HTML / PDF 路线，后续再查是否存在稳定接口`
9. 当前验证等级：`liveVerified=true / site_access_only`
10. 当前实测结论：首页可正常访问并返回平台介绍，但还没打通检索结果页和全文链路。

说明：

1. 我目前没有找到官方公开 API 文档
2. 所以现阶段不能把它当作公开 API 源来承诺

官方依据：

1. 中国科学院官方发布说明，首期可检索约 `1.7 亿` 资源，可免费获取全文约 `8000 万`，包含论文、学位论文、预印本、专利、科学数据和图书专著  
   <https://www.las.ac.cn/front/notice/detail?id=490>
2. 中科院官方新闻报道  
   <https://www.cas.cn/cm/202311/t20231102_4984055.shtml>

### 3. ChinaXiv

为什么要补：

1. 中文科研预印本重要补充
2. 对科技论文、中文研究前沿很有价值
3. 官方帮助里直接列了 `OAI-PMH`

元数据判断：

1. 语言：中文为主，含英文
2. 类型：预印本、部分已发表论文
3. 完整内容：`mixed`
4. 获取方式：`页面检索 + PDF + OAI-PMH`
5. 认证：`optional`
6. 反爬风险：`low`
7. 推荐角色：`hybrid`
8. DeepSearch 适配建议：`优先走 OAI-PMH / 公开页面，浏览器为辅`
9. 当前验证等级：`liveVerified=true / access_denied`
10. 当前实测结论：这台机器访问其官方 OAI 端点被访问控制拦截，暂时不能据此认定公开抓取可用。

官方依据：

1. ChinaXiv 平台简介  
   <https://chinaxiv.org/user/help.htm?locale=zh_CN>
2. 帮助页明确有 `OAI-PMH 开放接口`  
   <https://chinaxiv.org/user/help.htm?locale=en&serverID=4>

### 4. Chinese Text Project

为什么要补：

1. 中文古籍和先秦两汉文本非常强
2. 官方提供 API、OAI-PMH、RDF
3. 很适合做古文资料库

元数据判断：

1. 语言：中文为主
2. 类型：先秦两汉到后世的大量古籍文本
3. 完整内容：`mixed`
4. 获取方式：`CTP API + OAI-PMH + RDF`
5. 认证：`mixed`
6. 反爬风险：`low`
7. 推荐角色：`hybrid`
8. DeepSearch 适配建议：`API 直连优先`
9. 当前验证等级：`liveVerified=true / full_content`
10. 当前实测结论：公开 API 已直接拿到《论语·学而》正文，说明至少部分古籍内容可直接机器读取。

注意：

1. 公开 API 可取文本和 metadata
2. 整书结构下载等高级功能，官方明确对认证用户或订阅用户开放

官方依据：

1. CTP API  
   <https://ctext.org/tools/api>
2. CTP 开放数字图书馆说明  
   <https://ctext.org/>
3. 订阅页说明额外 API 功能和 API keys  
   <https://ctext.org/tools/subscribe/ens>

### 5. 国家图书馆中华古籍资源库 / 智慧化服务平台

为什么要补：

1. 官方中文古籍资源很强
2. 资源量大
3. 对地方志、善本、敦煌文献、碑帖等特别有价值

元数据判断：

1. 语言：中文
2. 类型：古籍、地方志、甲骨、敦煌文献、碑帖、家谱等
3. 完整内容：`full_scan`
4. 获取方式：`在线阅读为主`
5. 认证：`optional`
6. 反爬风险：`medium`
7. 推荐角色：`fulltext`
8. DeepSearch 适配建议：`影像阅读 / OCR / 摘录路线`
9. 当前验证等级：`liveVerified=true / search_and_metadata`
10. 当前实测结论：资源介绍页和 `read.nlc.cn` 古籍列表页都可公开访问，能拿到标题、责任者和缩略图，但未验证单书影像全文抓取。

注意：

1. 最稳定的是影像全文
2. 不是天然的机器可读全文主源

官方依据：

1. 国家图书馆数字资源说明  
   <https://www.nlc.cn/>
2. 中华古籍资源库介绍  
   <https://www.nlc.cn/pcab/zy/zhgj_zyk/index.shtml>
3. 智慧化服务平台上线说明  
   <https://www.nlc.cn/web/dsb_zx/gtxw/20250520_2645084.shtml>

### 6. CADAL

为什么要补：

1. 中文图书、古籍、民国图书、学位论文覆盖广
2. 检索能力强
3. 很适合做“中文图书发现 + 部分在线阅读”

元数据判断：

1. 语言：中文为主，含外文
2. 类型：古籍、民国图书、当代图书、外文图书、学位论文等
3. 完整内容：`mixed`
4. 获取方式：`检索 + 在线阅读 + 借阅后阅读`
5. 认证：`mixed`
6. 反爬风险：`medium`
7. 推荐角色：`hybrid`
8. DeepSearch 适配建议：`先 discovery，再按 item 权限决定是否全文拉取`
9. 当前验证等级：`liveVerified=true / search_and_metadata`
10. 当前实测结论：单书详情页可公开访问并返回资源元数据，但页面逻辑显示登录、借阅、试读限制，未验证正文全文抓取。

注意：

1. 官方公开检索很强
2. 但部分资源有“试读”“章节阅读”“借阅后有 7 天阅读时长”等限制
3. 所以不能把它当作无认证批量全文源

官方依据：

1. CADAL 官方首页资源概况  
   <https://cadal.edu.cn/>
2. 官方检索结果和详情页可见“阅读”“试读”“章节阅读”“借阅”路径  
   <https://cadal.edu.cn/cadalinfo/search?oneOrSecond=first&searchContent=%E5%8F%B2%E8%AE%B0&searchType=title>
   <https://cadal.edu.cn/cardpage/bookCardPage?ssno=06850835>

## 建议的中文补充顺序

第一批：

1. `中文维基文库`
2. `Chinese Text Project`
3. `国家哲学社会科学文献中心`

第二批：

1. `国家图书馆中华古籍资源库`
2. `CADAL`
3. `PubScholar`

第三批：

1. `ChinaXiv`

## 中文源验证脚本

这轮中文源 live 验证脚本在：

1. [verify-chinese-content-sources.mjs](/Users/zhangjun/私藏/lumos/scripts/deepsearch/verify-chinese-content-sources.mjs)

当前脚本已实测：

1. `中文维基文库`
2. `Chinese Text Project`
3. `ChinaXiv`
4. `国家哲学社会科学文献中心`
5. `PubScholar`
6. `CADAL`
7. `国家图书馆中华古籍资源库`

## 接入建议

不要把所有源都做成一个 adapter 形态。

应该拆成三类：

1. `API / OAI-PMH / dump adapter`
   - Gutenberg
   - Wikisource
   - PMC
   - Europe PMC
   - ChinaXiv
   - CText
2. `账号态站点 adapter`
   - 国家哲学社会科学文献中心
   - PubScholar
   - CADAL
3. `扫描影像 + OCR adapter`
   - 国家图书馆古籍资源

## 当前结论

1. 现在的英文源足够做第一批开放资料验证
2. 中文源确实偏少，必须补
3. 最该优先补的是：
   - `中文维基文库`
   - `国家哲学社会科学文献中心`
   - `ChinaXiv`
4. 如果目标是“代码直接读内容”，最稳的中文路径不是只靠一个站，而是：
   - `公版全文`
   - `社科注册库`
   - `预印本`
   - `古籍 API / 影像`
   这四条同时存在
