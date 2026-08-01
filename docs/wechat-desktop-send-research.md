# 用本人微信号主动发消息 —— 技术调研（Windows）

调研日期：2026-07-31
状态：**调研结论，未动任何代码**。落地涉及加依赖 + 新架构，属红线，待拍板。

---

## 一、先说结论

Windows 上让 Lumos 用**用户本人的微信号**给**任意好友**主动发消息，**技术上可行**，推荐走
**UIAutomation 控件树自动化**这条路：不注入、不改微信进程、不碰协议，靠系统无障碍接口
定位微信自己的控件，剪贴板贴入 + 回车发出。

代价是三条，都得认：

1. **发消息的那一两秒会占用用户的界面** —— 微信窗口必须被激活到前台，键盘和剪贴板被短暂借用。
   做不到真正的后台静默发送。
2. **微信改界面就可能失灵** —— 依赖的是控件名（`mmui::ChatInputField` 这类），微信大版本
   重构 UI 就要跟着修。
3. **这是微信用户协议不允许的操作** —— 与现有"读聊天记录"同性质。低频个人使用封号风险低，
   但一旦被拿去群发就完全是另一回事，产品侧必须堵死群发。

**不推荐** DLL 注入（wxhook / wxhelper 那一系）：能力更强、能后台发，但每个微信小版本都要
重新对偏移量，杀软报毒，且是在改用户微信进程的内存——对一个要发版给别人用的桌面产品来说，
维护成本和信任成本都不可接受。

---

## 二、Windows 微信 4.x 的关键事实（这条路能不能走，卡在这里）

### 2.1 "UI 树消失"是个误会

微信 4.0.3 起，PC 端放弃 Windows 原生控件，改成跨平台自绘渲染。很多人用 Inspect 一看，
整个窗口是一张画布，什么控件都没有，于是得出"UIAutomation 死了"的结论。

**实际机制是按需暴露**：微信检测有没有合规的无障碍客户端连上来——当一个程序引用
`UIAutomationClient.dll` / `UIAutomationTypes.dll` 并成功附着到微信窗口时，微信判定为
"无障碍场景"，才加载完整的控件 Provider，UI 树才"长出来"。没检测到就只暴露最少的几个元素。

这解释了为什么社区里两种说法并存：随手用 Inspect 瞄一眼的人说"空壳"，真正用
Python `uiautomation` 库跑的人说"能用"——**后者本身就是一个 UIA 客户端，附着的那一刻树就出来了**。

实测版本：4.1.5.16。

### 2.2 树出来之后有什么

已有开源实现（`LAVARONG/wechat-automation-api`，Flask + uiautomation，声明支持 4.0+）
给出了具体的控件坐标系，这几个是发消息全流程需要的：

| 用途 | 控件 |
|---|---|
| 会话列表项 | `mmui::ChatSessionCell`，`AutomationId="session_item_<联系人名>"` |
| 搜索框（会话列表里没有时的兜底） | `EditControl(Name="搜索")` |
| 消息输入框 | `mmui::ChatInputField` |

发送流程：**先在会话列表找人 → 找不到就走搜索框 → 文本/图片/文件放剪贴板 → 粘贴进输入框 → 回车**。
支持按联系人名、备注名、群名精确匹配。

### 2.3 硬约束

- 微信窗口必须可见且激活（该项目用 `Ctrl+Alt+W` 唤起微信），**最小化或锁屏状态下会失败**。
- 依赖剪贴板，远程桌面断开的会话里会失效（该项目要专门跑 `disconnect_rdp.bat` 保住输入焦点）。
- 微信 UI 变更会打断控件定位。

---

## 三、四条路线的取舍

| 路线 | 能否后台发 | 版本脆性 | 封号风险 | 结论 |
|---|---|---|---|---|
| **A. UIA 控件树自动化** | 否，要抢前台 | 中（跟着 UI 改） | 低 | ✅ **推荐** |
| B. DLL 注入（wxhook / wxhelper） | 是 | **极高**（逐版本对偏移） | 低到中 | ❌ 维护与信任成本不可接受 |
| C. 协议模拟（iPad/Mac 协议） | 是 | 中 | **中到高**，服务端可检测，有大量封号案例 | ❌ 否决 |
| D. 安卓 + worktool（专用手机） | 是 | 低 | 低 | ❌ 要一台专用手机，不属于桌面端范畴 |

关于 B 补充一句：`miloira/wxhook`（MIT）版本列表确实跟得很紧，一直更新到 4.1.8.67，
说明生态还活着。但它的支持方式就是把每个版本的内存偏移写死一份——用户微信自动升级一次，
Lumos 就得发一版补丁，这个节奏跟不上。作为**用户自己折腾的高级选项**可以留个口子，
但不该是 Lumos 的主路径。

关于封号风险的量级参考（跨平台可行性调研的结论）：数据库解密≈零风险；UI 自动化低风险，
主要暴露面是行为异常（回复速度均匀、24 小时在线）；Hook 注入低到中；协议模拟中到高。
公开的、纯因 UI 自动化被封的案例很少，被封的基本都是营销群发。

---

## 四、落到 Lumos 的架构

### 4.1 现状盘点

- **收消息**：`src/lib/wechat-export/` + `resources/mcp-servers/wechat-export/`，Python 解密本地库，
  **纯只读**——`api.py` 的 `OPS` 表里没有任何写接口。
- **发消息**：只有 `src/lib/im/providers/wechat/`（ilink 机器人网关），
  `send.ts:53` 明确"the bot cannot initiate"，且 `manifest.ts` 里 `targetDirectory: false`。
  **结构上就不可能主动发起**，跟本需求不是一回事。
- **GUI 自动化能力：一行都没有**。全仓库没有 robotjs / pyautogui / uiautomation 任何依赖；
  `docs/computer-use-design.md:131` 把"鼠标键盘注入的原生依赖"列为**未决红线**；
  `src/lib/memory-v2/capability-lab.ts:151` 干脆把这类包列进了高风险黑名单。

**唯一的真实空白就是最后这一层**，其余都是现成的。

### 4.2 建议方案

**新增一个 IM provider：`wechat-desktop`**，与 ilink 那个 `wechat` provider 并存、互不干扰。

插件契约是开放的（`types.ts:43` `IMProviderId = string`），实现 `IMAdapter` 即可：

- `send()` → 调 Windows 侧的发送引擎（下述）
- `consumeOne()` → 直接返回 null（入站不走这里，本来就有镜像同步那条路）
- `IMTargetDirectory` → **可以实现**，联系人列表直接复用 wechat-export 现成的
  `list_contacts` / `list_sessions`。这一点比 ilink 强：ilink 因为没有联系人接口才没实现，
  桌面端有本地通讯录，`im_list_targets` 这类主动外发工具就能用起来了。

要改的硬编码分支共 7 处（新增 provider id 的固定成本）：`im/index.ts` 注册表、
`electron/bridge/im-runtime-manager.ts` 的 createAdapter 分支、`im-providers.ts`、
`api/im/runtime/ingest/route.ts` 白名单、`outbound-target.ts` 兜底路由、
`ImProviderCard.tsx` 的绑定 UI 分支、以及各自的 setup 路由。

**发送引擎**：Python 脚本 + `uiautomation` 库，沿用 wechat-export 已经跑通的那套桥接模式
（`api-bridge.ts`：spawn 一次性进程，stdin 喂 JSON，stdout 收 JSON）。Python 环境是现成的
（`python-venv.ts`，`~/.lumos/python-venv`），只多装一个 pip 包。

**但有一点必须和读链路不同：发送必须全局串行。** UI 自动化在抢同一个前台窗口，
两个发送任务并发就会互相把焦点抢掉、内容串台。要在 Node 侧加单飞队列 + 互斥，
外加可配的发送间隔（参考实现默认 1 秒）。

### 4.3 授权与护栏

现成可复用：`disclaimer.ts` 的版本化免责声明（文案改了哈希变、强制重新同意）+
`setup-state.ts` 的分阶段门禁（`needs-consent → needs-env → … → ready`）。

发送比读取危险一个量级，建议**单独一道同意**，不与"读聊天记录"共用，文案要写明：
会占用界面、会用你本人身份发出、微信协议不允许、封号风险自负。

必须有的护栏：

- **AI 发起的发送一律先草稿后确认**，不允许默认自动发出（这和内置级应用的写操作规则一致，
  `docs/computer-use-design.md:124` 也早把"发消息"预判为强制二次确认的高风险动作）。
- **禁群发**：单次只能一个收件人，频率上限，不提供通讯录批量接口。这是封号风险的主要来源，
  也是这个能力被滥用的唯一形态。
- **一键急停** + 发送日志留痕（发给谁、发了什么、什么时候）。
- 用户正在打字时不抢焦点。

---

## 五、还没验证的、需要在 Windows 真机上确认的

调研做到这里，剩下的不确定性只能在装了微信的 Windows 机器上验掉。附录的探测脚本
**只读 UI 树、不发任何消息**，跑一次就能回答：

1. 你那台机器的微信版本，UI 树能不能"长出来"
2. `mmui::ChatSessionCell` / `EditControl(Name="搜索")` / `mmui::ChatInputField` 这三个
   控件是否都在（社区结论基于 4.0.5 / 4.1.5.16，你的版本可能又变了）
3. 输入框是否支持 ValuePattern 直接置值——如果支持，也许能**少抢一点焦点**，
   这是能不能做得不那么打扰用户的关键

第 3 点特别值得试：如果 `ValuePattern.SetValue` 能直接把文本塞进输入框，就不需要剪贴板，
也不需要模拟键盘输入；再配合往窗口直接投递回车消息，理论上能把"抢前台"的时间压到最短。
没人写过这条路能不能走通，得实测。

---

## 六、要你拍板的三件事

1. **加不加这个能力** —— 它触碰了 `computer-use-design.md` 里挂起的那条红线
   （GUI 自动化依赖）。同意的话，`capability-lab.ts` 的高风险黑名单也要相应开个受控口子。
2. **走 A 还是给 B 留后门** —— 建议主路径只做 A（UIA），B（注入）连口子都不留，
   避免维护地狱和杀软误报。
3. **默认是否必须人工确认才发出** —— 我的建议是必须，且不给"记住我的选择"式的全局豁免。

---

## 附录：Windows 真机探测脚本（只读，不发消息）

在 Windows 上、微信登录并保持窗口打开的状态下运行：

```bat
pip install uiautomation
python wechat_uia_probe.py
```

```python
"""WeChat Windows UI 树探测 —— 只读，不发送任何消息。

回答三个问题：UI 树能不能长出来；发消息需要的三个控件在不在；输入框能不能直接置值。
"""
import sys

import uiautomation as auto

WANTED = {
    "会话列表项": lambda c: "ChatSessionCell" in (c.ClassName or ""),
    "搜索框": lambda c: c.ControlTypeName == "EditControl" and "搜索" in (c.Name or ""),
    "消息输入框": lambda c: "ChatInputField" in (c.ClassName or ""),
}


def walk(ctrl, depth, found, stats, max_depth=14):
    stats["nodes"] += 1
    key = ctrl.ClassName or ctrl.ControlTypeName
    stats["classes"][key] = stats["classes"].get(key, 0) + 1
    for label, match in WANTED.items():
        try:
            if match(ctrl):
                found.setdefault(label, []).append(ctrl)
        except Exception:
            pass
    if depth >= max_depth:
        return
    for child in ctrl.GetChildren():
        walk(child, depth + 1, found, stats)


def main():
    win = auto.WindowControl(searchDepth=1, ClassName="mmui::MainWindow")
    if not win.Exists(3):
        win = auto.WindowControl(searchDepth=1, RegexName=".*微信.*")
    if not win.Exists(3):
        print("没找到微信窗口——确认微信已登录且窗口没有最小化")
        return 2

    print(f"窗口: Name={win.Name!r} ClassName={win.ClassName!r}")
    found, stats = {}, {"nodes": 0, "classes": {}}
    walk(win, 0, found, stats)

    print(f"\nUI 树节点数: {stats['nodes']}")
    if stats["nodes"] < 20:
        print("=> 树几乎是空的，UIA 这条路在这个版本上要重新评估")
    top = sorted(stats["classes"].items(), key=lambda kv: -kv[1])[:15]
    print("控件类型分布:", dict(top))

    print("\n--- 发消息所需控件 ---")
    for label in WANTED:
        hits = found.get(label, [])
        print(f"{label}: {len(hits)} 个")
        for c in hits[:3]:
            print(f"    Name={c.Name!r} ClassName={c.ClassName!r} AutomationId={c.AutomationId!r}")

    box = (found.get("消息输入框") or [None])[0]
    if box:
        try:
            pattern = box.GetValuePattern()
            print(f"\n输入框 ValuePattern: 可用, IsReadOnly={pattern.IsReadOnly}")
            print("=> 可能支持直接置值（不需剪贴板/键盘模拟），值得进一步实测")
        except Exception as err:
            print(f"\n输入框 ValuePattern 不可用: {err}")
            print("=> 只能走剪贴板粘贴 + 回车")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

---

## 参考

- [微信 4.1 为什么"看不到" UI 树？如何重新"长出来"](https://blog.csdn.net/WWW7530471/article/details/155169701)
- [微信 4.1.5.16 UI 树"消失"？UIAutomation 实战复现](https://jishuzhan.net/article/2051938114290122754)
- [LAVARONG/wechat-automation-api](https://github.com/LAVARONG/wechat-automation-api) — UIA + 剪贴板，4.0+
- [miloira/wxhook](https://github.com/miloira/wxhook) — DLL 注入路线，MIT，版本列表到 4.1.8.67
- [AngeCoo/wxauto-4.0](https://github.com/AngeCoo/wxauto-4.0) — 锁定 4.0.5
- [wechatferry 关于 4.x 无法使用的讨论](https://github.com/wechatferry/wechatferry/discussions/68)
- [跨平台微信自动化可行性调研](https://yage.ai/share/wechat-uia-platform-feasibility-survey-en-20260327.html) — 封号风险分级
