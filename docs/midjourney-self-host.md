# 自建 Midjourney 代理接入 Lumos

用**自己的 Midjourney 订阅**给 Lumos 供图，替代按次付费的第三方中转。

> Midjourney 至今（2026-08）没有公开的官方 API，只有企业版可申请。所以"用自己的账号调 API"唯一的路，
> 就是自己跑一个代理：它接收 HTTP 请求 → 用你的 Discord 账号在你自己的频道里给 MJ 机器人发消息 →
> 盯着回复 → 把结果转成 HTTP 响应。第三方中转商做的也是这件事，只是他们维护了一池子账号。

---

## 1. 成本对照（决定值不值得折腾）

实测第三方中转是 **$0.30 / 任务**。注意"任务"不等于"一张图"：出图、选图（U 按钮）、局部重绘、抠图、
图生文各算一次。所以"出图 → 选图 → 局部重绘"一套完整流程就是 3 个任务。

| 方案 | 200 个任务 | 1000 个任务 |
|---|---|---|
| 第三方中转（$0.30/任务） | $60 | $300 |
| MJ Basic $10/月（约 200 jobs） | $10 | 额度不够，要加购 |
| **MJ Standard $30/月（Relax 不限量）** | **$30** | **$30** |

批量铺图选 **Standard**：它的 `Unlimited Relax image generations` 是慢速排队但**不限量**，
摊到 1000 个任务就是 $0.03/任务。Basic 那档没有这个，200 个用完就得加购。

**代价**：Relax 要排队等几分钟；自己扛 proxy 运维；以及下面这条风险。

## 2. 风险须知（先看完再决定）

代理的原理是拿**你的 Discord 用户令牌**去自动操作，这在 Discord 属于 self-bot，
**违反其服务条款**，理论上有封号风险，且会连带你的 MJ 订阅。

实际这么用的人很多、封号不常见，但这是你的账号。**建议专门开一个小号订阅 MJ 跑自动化，别用主力号。**

## 3. 需要准备什么

- 一台**境外** VPS（新加坡/香港/日本均可，最低配够用）—— Discord 在国内访问不了，
  国内机器（包括跑 lumos-web 那台）部署上去会一直连不上
- Midjourney 订阅账号
- Discord 账号

---

## 4. 第一步：Discord 侧准备（这几步必须你自己做）

代理需要三个参数：**user token、guild id、channel id**。它们绑定你的登录态，别人拿不到也代拿不了。

### 4.1 建一个自己的服务器

Discord 客户端左侧栏最下面的 `+` → 「亲自创建」→ 随便起个名。这个服务器只用来跑机器人，不用邀请任何人。

### 4.2 把 Midjourney Bot 拉进来

进 Midjourney 官方 Discord → 找到 `Midjourney Bot` → 点它的头像 → 「添加至服务器」→ 选你刚建的服务器 → 授权。

拉进来后，在你自己服务器的频道里发一条 `/imagine` 试试，**能出图才算这一步成功**。出不了图就别往下走。

### 4.3 取 guild id 和 channel id

先开开发者模式：Discord 设置 → 「高级设置」→ 打开「开发者模式」。

然后：
- **guild id**：右键你的服务器图标 → 「复制服务器 ID」
- **channel id**：右键你要用的那个频道 → 「复制频道 ID」

### 4.4 取 user token（最敏感的一步）

用**浏览器版** Discord（`discord.com/app`）登录 → 按 `F12` 打开开发者工具 → 切到 `Network`（网络）
→ 在 Discord 里随便点一下触发请求 → 找任意一条发往 `discord.com/api` 的请求 → 看它的请求头，
`authorization` 那一行的值就是你的 user token。

> ⚠️ **这串东西等同于你 Discord 账号的密码**。谁拿到都能登录你的账号。
> 别发到聊天里、别写进任何会进 git 的文件、别截图。下面配置时你自己在后台粘贴。

三个参数都拿到后，进第二步。取参数遇到界面对不上，看官方 [WIKI](https://github.com/trueai-org/midjourney-proxy/wiki)。

---

## 5. 第二步：VPS 上起服务

用 `trueai-org/midjourney-proxy`（C#/.NET 版）。选它是因为原版 `novicezk/midjourney-proxy`
最后更新停在 2025-08，积压 170 个 issue 已经停摆；trueai-org 这支到 2026-07 还在更新，且自带管理后台。

VPS 上装好 Docker，然后：

```bash
mkdir -p /root/mjopen/{logs,data,attachments,ephemeral-attachments}

docker run --name mjopen -d --restart=always \
 -p 8086:8080 --user root \
 -v /root/mjopen/logs:/app/logs:rw \
 -v /root/mjopen/data:/app/data:rw \
 -v /root/mjopen/attachments:/app/wwwroot/attachments:rw \
 -v /root/mjopen/ephemeral-attachments:/app/wwwroot/ephemeral-attachments:rw \
 -e TZ=Asia/Shanghai \
 -v /etc/localtime:/etc/localtime:ro \
 -v /etc/timezone:/etc/timezone:ro \
 ghcr.io/trueai-org/midjourney-proxy
```

拉不动 ghcr 就换 `registry.cn-guangzhou.aliyuncs.com/trueai-org/midjourney-proxy`
或 `trueaiorg/midjourney-proxy`，三个镜像内容一样。

服务起在 **8086** 端口。记得在 VPS 防火墙/安全组放行，并且**只放行你需要的来源**——
这个端口能直接调用你的 MJ 额度，不要对全网敞开。

## 6. 第三步：后台配置

浏览器打开 `http://<你的VPS_IP>:8086`。

1. **首次登录的管理员 token 是 `admin`**，登录后**立刻改掉**
2. 在账号管理里新增一个 Discord 账号，把第一步拿到的 **user token / guild id / channel id** 填进去
3. 等它显示连接成功、账号在线
4. 新建一个**普通用户 token**（只能调绘图接口、登不了后台）——**这个才是填进 Lumos 的那把 key**，
   别把管理员 token 给 Lumos

## 7. 第四步：接到 Lumos

Lumos 设置 →「图片生成」→ 添加服务商，选 Midjourney 预设，改两个字段：

| 字段 | 填什么 |
|---|---|
| base_url | `http://<你的VPS_IP>:8086`（**不要**加 `/mj` 后缀） |
| api_key | 第 6 步建的**普通用户 token** |

鉴权头 Lumos 会同时发 `Authorization: Bearer` 和 `mj-api-secret` 两种，中转网关和自建 proxy
各取所需，不用你操心填哪种。

## 8. 验证清单（逐条过，别只看"没报错"）

1. 在 Lumos 里出一张图 → 拿到 4 张候选
2. 挑一张做局部重绘 → 框外像素不变
3. 去 proxy 后台看任务列表，确认任务确实是你的 Discord 账号跑的
4. 去 Midjourney 官网看用量，确认扣的是你自己的订阅额度

## 9. 已知的坑

- **国内机器一定连不上 Discord**：proxy 必须在境外，或给它配能访问 Discord 的出网代理
- **Relax 模式很慢**：Standard 的不限量额度走的是 Relax，排队几分钟正常，别当成卡死。
  Lumos 客户端的轮询超时是 15 分钟
- **并发受订阅档位限制**：Basic/Standard 都是同时 3 个任务，Pro/Mega 才 12 个。
  批量出图会排队，不是坏了
- **出图地址有时效**：MJ 返回的图片地址 24 小时后失效。Lumos 拿到就立刻下载成本地文件，不存地址
- **自建的上传接口是通的**：第三方中转常常没开 `upload-discord-images`，Lumos 只好借 `describe`
  当图床（那也算一次收费任务）。自建后这个接口可用，垫图能省掉这笔开销
