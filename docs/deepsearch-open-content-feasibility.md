# DeepSearch 开放图书与论文源可行性结论

## 目标

1. 先确认哪些公开源适合做大量资料搜索和学习
2. 再确认每个源的获取方式、认证要求、限流和反爬约束
3. 最后用程序验证最小可用链路

## 结论

第一批最值得接入验证的源有五类：

1. `Project Gutenberg`
2. `Wikisource / 维基文库`
3. `PMC Open Access / BioC API`
4. `Europe PMC`
5. `arXiv`

第二批可作为扩展源：

1. `OpenAlex`
2. `CORE`
3. `Open Library`

不建议第一阶段把它们都做成浏览器抓取。

更合适的形态是：

1. `API / dump / feed` 直连
2. 统一规范化成 `metadata + content + license + source_url`
3. 再把这套能力挂进 DeepSearch

## 推荐优先级

### Tier A：最适合先接

#### 1. Project Gutenberg

适合：

1. 公共领域英文图书
2. 机器可读文本语料
3. 本地全文检索

优点：

1. 官方长期稳定
2. 直接提供 `plain text`
3. 还提供可机器消费的目录和全量 `txt` 打包

限制：

1. 现代版权图书覆盖弱
2. 以英文为主

获取方式：

1. 单书直接取 `txt / html / epub`
2. 批量优先使用官方目录和离线 catalog
3. 不要抓网页 HTML 列表自己爬

认证：

1. 不需要认证

反爬 / 限制：

1. 官方明确建议开发者使用机器可读 metadata 文件，不要对网站做 crawling/roboting

官方依据：

1. Gutenberg 说明 `2004` 年后的电子书几乎都以 `plain text` 和 `HTML` 作为主格式  
   <https://dev.gutenberg.org/help/file_formats.html>
2. Gutenberg 提供 `XML/RDF/CSV` catalog，并明确建议开发者用这些文件而不是爬站  
   <https://www.gutenberg.org/ebooks/offline_catalogs.html>

质量判断：

1. `内容质量：高`
2. `结构化程度：中`
3. `法律可用性：高`
4. `覆盖广度：中`

#### 2. Wikisource / 维基文库

适合：

1. 公共领域文本
2. 古籍、史料、经典文本
3. 多语言资料

优点：

1. 正文文本质量通常好于 OCR
2. 可用 MediaWiki API 读正文
3. 可导出 EPUB / PDF 等

限制：

1. 覆盖不均匀
2. 某些页面是章节页、目录页、跨页转写页，需要二次清洗

获取方式：

1. 用 `w/api.php` 读页面内容
2. 或用 `WS Export` 导出

认证：

1. 只读接口一般不需要认证

反爬 / 限制：

1. 不建议从人类页面直接抓 DOM
2. 应优先使用 MediaWiki Action API

官方依据：

1. MediaWiki 官方说明所有 Wikimedia 站点都提供 `w/api.php` 形式的 Action API  
   <https://www.mediawiki.org/wiki/API:Action_API>
2. `action=query` 是官方读取页面和数据的基础模块  
   <https://www.mediawiki.org/wiki/API:Query>
3. Wikisource 官方 `WS Export` 支持导出 `EPUB / PDF` 等格式  
   <https://wikisource.org/wiki/Wikisource:WS_Export>

质量判断：

1. `内容质量：高`
2. `结构化程度：中`
3. `法律可用性：高`
4. `覆盖广度：中`

#### 3. PMC Open Access / BioC API

适合：

1. 生物医学论文全文
2. 高质量机器阅读
3. 结构化语料构建

优点：

1. 官方直接提供全文
2. 有 `XML / JSON / BioC / FTP / OAI-PMH`
3. 许可证边界清楚

限制：

1. 学科集中在生物医学
2. 不是所有 PMC 文章都能自由拿全文
3. 要按 license 过滤

获取方式：

1. 小规模用 `BioC API`
2. 中大规模用 `FTP / Cloud / OAI-PMH`
3. 用 `oa_file_list` 或 CSV 清单做增量管理

认证：

1. 不需要认证

反爬 / 限制：

1. 不应直接抓页面
2. 应用官方提供的 `Cloud / FTP / OAI / BioC / E-Utilities`

官方依据：

1. PMC OA Subset 官方列出 `Cloud / FTP / OAI-PMH / OA Web Service / E-Utilities / BioC API` 等 retrieval 方法  
   <https://pmc.ncbi.nlm.nih.gov/tools/openftlist/>
2. BioC API 官方说明提供 `BioC XML / BioC JSON / Unicode / ASCII`，并给出标准接口格式  
   <https://www.ncbi.nlm.nih.gov/research/bionlp/APIs/BioC-PMC/>

质量判断：

1. `内容质量：很高`
2. `结构化程度：很高`
3. `法律可用性：高，但必须按 license 过滤`
4. `覆盖广度：中`

#### 4. Europe PMC

适合：

1. 生命科学论文检索
2. 元数据 + 摘要 + 全文链接获取
3. 研究资料搜索

优点：

1. REST API 直接可用
2. JSON / XML 都支持
3. 还带 citation、annotation、full text links

限制：

1. 领域偏生命科学
2. 不是所有结果都有全文正文

获取方式：

1. 用 REST 搜索做发现
2. 对命中结果再跟进 open access 全文链接

认证：

1. 不需要认证

反爬 / 限制：

1. 应直接使用公开 REST API
2. 不需要浏览器接管

官方依据：

1. Europe PMC RESTful Web Service 提供 JSON / XML / DC 格式  
   <https://dev.europepmc.org/RestfulWebService>
2. 官方说明可访问 `full text articles`、`open access articles`、`full text links`

质量判断：

1. `内容质量：高`
2. `结构化程度：高`
3. `法律可用性：中到高，取决于目标全文链接`
4. `覆盖广度：中`

#### 5. arXiv

适合：

1. 计算机、数学、物理等领域预印本
2. 论文发现
3. PDF / source 下载

优点：

1. 无需认证
2. API 简单稳定
3. 公开 corpus 很大

限制：

1. 预印本不等于同行评审论文
2. API 返回主要是 `Atom XML metadata`
3. 真正全文通常还是 PDF 或源码包，正文清洗要自己做

获取方式：

1. 检索用 `export.arxiv.org/api/query`
2. 批量 metadata 用 `OAI-PMH`
3. 大规模全文用官方 `S3` 路线

认证：

1. 不需要认证

反爬 / 限制：

1. 官方建议多次调用时加入 `3 秒` delay
2. 单次最多 `30000` 结果，但建议分片且少量请求
3. 大批量 harvesting 应转 `OAI-PMH`

官方依据：

1. arXiv API Basics  
   <https://info.arxiv.org/help/api/basics.html>
2. arXiv User Manual 中明确建议多次调用加入 `3 second delay`，并说明分页和批量限制  
   <https://info.arxiv.org/help/api/user-manual.html>

质量判断：

1. `内容质量：中到高`
2. `结构化程度：中`
3. `法律可用性：高`
4. `覆盖广度：中到高`

### Tier B：适合第二阶段接

#### 6. OpenAlex

定位：

1. 最强发现层之一
2. 适合找 `works / books / topics / ids`
3. 也支持拿 OA PDF / TEI XML 内容

优点：

1. 检索能力强
2. `works` 同时覆盖文章、书、数据集
3. 内容下载路径清晰

限制：

1. 官方文档当前要求 API key
2. 真正大规模 content 下载是付费模型
3. 更适合作为 discovery + content locator，而不是第一阶段唯一全文源

获取方式：

1. 元数据和检索走 OpenAlex API
2. 内容下载走 `content_url / CLI / archive sync`

认证：

1. 需要 API key
2. key 免费

反爬 / 限制：

1. 不要抓网页
2. 直接用 API / CLI / archive sync

官方依据：

1. OpenAlex API Overview  
   <https://developers.openalex.org/api-reference/introduction>
2. OpenAlex Full-text PDFs 文档说明：
   - 可用 `content_url`
   - 免费 key 约可下载 `100` 个文件/天
   - 更大规模走 CLI 或 archive sync  
   <https://developers.openalex.org/download/full-text-pdfs>

质量判断：

1. `内容质量：高`
2. `结构化程度：高`
3. `法律可用性：中到高，取决于 OA 与 license`
4. `覆盖广度：很高`

#### 7. CORE

定位：

1. 大型开放获取论文聚合器
2. 很适合做论文全文搜索和统一接入

优点：

1. 聚合量大
2. 同时有 metadata 和 full text
3. 非常适合做“统一论文入口”

限制：

1. 接入和配额比 Europe PMC / arXiv 更重
2. 注册和商业条款要提前看清
3. 不同来源的正文质量不完全一致，PDF 清洗成本仍在

获取方式：

1. API
2. Dataset
3. FastSync

认证：

1. 可免费访问，但官方明确建议注册拿 key
2. 注册用户和会员有更高速度

反爬 / 限制：

1. 不建议页面抓取
2. 应使用 API / dataset
3. 有明确 quota

官方依据：

1. CORE API 文档说明提供 metadata + full-text content，并列出 quota  
   <https://core.ac.uk/documentation/api>
2. CORE 服务页说明可免费 API 访问，但注册用户速度更好，也支持更大规模方案  
   <https://core.ac.uk/services/api>

质量判断：

1. `内容质量：中到高`
2. `结构化程度：中`
3. `法律可用性：中到高，取决于来源与许可`
4. `覆盖广度：很高`

#### 8. Open Library

定位：

1. 书籍发现层
2. 不适合作为第一阶段全文主源

优点：

1. API 简单
2. 数据公开
3. 能快速识别作品、版本、可读性、Archive 可用性

限制：

1. 官方明确不建议把 Web API 当 bulk backend
2. 真正全文仍依赖 archive 可读性和外部资源

获取方式：

1. 搜索 API
2. Work / Edition JSON
3. 需要 bulk 时改用 monthly dumps

认证：

1. 不需要认证

反爬 / 限制：

1. 官方明确说 bulk 不要走 Web API
2. 批量导入应使用 data dumps

官方依据：

1. Open Library Developer Center  
   <https://openlibrary.org/developers/api>
2. Open Library Search API  
   <https://openlibrary.org/dev/docs/api/search>

质量判断：

1. `内容质量：中`
2. `结构化程度：高`
3. `法律可用性：高`
4. `覆盖广度：高`

## 对 DeepSearch 的直接建议

第一阶段不要用浏览器抢页面去抓这些公开源。

应该按下面顺序做：

1. `Project Gutenberg adapter`
2. `Wikisource adapter`
3. `Europe PMC adapter`
4. `PMC BioC adapter`
5. `arXiv adapter`

这些都更像：

1. `API / feed / dump adapter`
2. 不是 `browser takeover adapter`

第二阶段再加：

1. `OpenAlex discovery adapter`
2. `CORE adapter`
3. `Open Library discovery adapter`

## 程序验证范围

仓库里已补最小验证脚本：

1. [scripts/deepsearch/verify-open-content-sources.mjs](/Users/zhangjun/私藏/lumos/scripts/deepsearch/verify-open-content-sources.mjs)

它会验证：

1. Gutenberg 文本读取
2. Wikisource API 正文读取
3. Europe PMC 搜索
4. PMC BioC 全文 JSON
5. arXiv API
6. Open Library 搜索
7. OpenAlex 可选验证
8. CORE 可选占位

## 当前机器的首轮验证结果

本机首轮联网验证结论：

1. `Project Gutenberg`：直接拿到 `txt` 全文，成功
2. `Wikisource`：通过 MediaWiki API 拿到正文，成功
3. `Europe PMC`：搜索 + 摘要 + 全文链接探测，成功
4. `PMC BioC`：接口可访问，脚本已兼容其真实返回结构
5. `Open Library`：搜索与 fulltext 指示字段，成功
6. `arXiv`：当前机器 / IP 命中 `429`，说明接入时必须加节流和备用策略
7. `OpenAlex`：缺少 API key，未在本机做 live 验证
8. `CORE`：缺少 API key，未在本机做 live 验证

这意味着：

1. 图书主源已经至少有两条可直接验证通过的公开路径
2. 论文主源已经至少有两条可直接验证通过的公开路径
3. `arXiv` 不是不可行，而是接入时要把限流处理当成正式需求

## 当前判断

如果你的目标是：

1. 做合法的大规模资料搜索
2. 让代码直接读内容
3. 后续再接入 Lumos 的 DeepSearch

那这件事是可行的。

最稳的切法不是“一个万能源”，而是：

1. `图书：Gutenberg + Wikisource`
2. `生命科学论文：PMC OA + Europe PMC`
3. `理工预印本：arXiv`
4. `统一发现层：OpenAlex`
5. `第二阶段聚合器：CORE`
