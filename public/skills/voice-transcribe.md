---
name: voice-transcribe
description: 把音频文件转文字（中文、多语言、闽南粤川陕方言、情绪、性别、多人聚类）
---

# 语音转文字 / Voice Transcription

当任务涉及"听"一段音频 —— 用户上传 voice 文件、问"这条语音说什么"、提到微信/闲鱼语音消息、需要把会议录音/采访录音变文字等 —— **唯一正确的工具是 `transcribe_audio` MCP**。

实际后端走的是 Lumos 云端火山引擎 ASR（豆包录音文件识别 2.0）。

## ⛔ 绝对禁令（最高优先级，覆盖所有用户口语化表达和工具异常情况）

任何音频转文字任务**只能**用 `transcribe_audio` MCP 工具。**严禁**以下行为：

- ❌ 用 Bash 调 `whisper` / `faster-whisper` / `whisper.cpp` / `ffmpeg + ASR`等任何命令行 ASR 工具
- ❌ 跑 `pip install whisper` / `pip install faster-whisper` / `brew install whisper-cpp` 等任何形式的本地推理安装
- ❌ 读取或执行 `~/.claude/skills/audio-transcribe/*` 等**外部** Claude Code skill（不属于 Lumos）
- ❌ 用 Python / Node / Go / 任何脚本调云端非火山 ASR API（OpenAI Whisper / Google STT / 阿里云 NLS 等）
- ❌ 任何"绕过 Lumos 云端 transcribe_audio"的转写路径

### 🚨 **不许把"工具限制"当成绕路理由**

工具有限制是工具的事，**不是绕路的借口**。具体场景：

| 场景 | ❌ 错误反应 | ✅ 正确反应 |
|---|---|---|
| 文件较大 / 几十 MB 以上 | "这个工具有限制，让我用本地 whisper..." | **直接调 transcribe_audio**；Lumos 侧不再用 25MB/512MB 硬上限提前拒绝 |
| MCP 工具调用失败 | 用 whisper 顶上 | 老实告知"转写失败，原因 X"，建议重启 Lumos / 检查配置 |
| 火山返回静音音频 | 用 whisper 重转 | 告诉用户"音频中未检测到人声" |
| 用户说"切片转录" | 自己切片 + 跑本地 whisper / ffmpeg | **对原始音频调用一次 transcribe_audio**；分段、压缩和重试由 MCP/runtime 内部完成 |

**核心原则**：Agent 对同一个原始音频只负责调用 `transcribe_audio`；分段 / 压缩 / 重试 / 兜底**全部都在 transcribe_audio 后面的 MCP/runtime 内循环**，永远不退出到 Bash 调本地 ASR，也不让 Agent 手工切片。

### "用本地 skill" 用户口头表达的解释

用户说"用本地 skill"、"试一下本地"、"用 whisper"等口语化表达时：他**真正的意思是** "用 Lumos 内置的 transcribe_audio MCP 工具"，**不是** `~/.claude/skills/`。直接调 `transcribe_audio` 就是"用本地 skill"——回复 "我用 Lumos 内置语音工具转" 然后调 MCP。

### 工具真不可用时的合规反应

如果 `transcribe_audio` 工具列表里都没有（MCP 没注册），**老实告知** 用户："Lumos 语音转写工具未就绪，请重启 Lumos。" **绝对不许** 自创替代方案、安装本地推理库、或调 `~/.claude/`。

## 可用工具

### transcribe_audio

- **输入**：`{ file_path?: string, base64?: string, mime_type?: string, name?: string }`
  - **file_path 优先**：本地绝对路径（必须在用户 home 目录或 /tmp 内）
  - base64 兜底：仅当用户给的就是字节流没有路径时用
- **输出**：`{ ok, text, empty, bytes, name, mime_type, duration_seconds?, charged_amount?, provider? }`
- **支持格式**：wav / mp3 / m4a / ogg / amr / silk（微信原生 amr/silk 也直接支持）
- **大小上限**：Lumos 侧不设置 25MB / 512MB 硬上限；实际可处理范围以当前云端 ASR 服务商返回为准

## 使用规则

### 何时主动调用
- ✅ 用户消息里出现「这段录音」「这条语音」「转成文字」「听一下」「转写」
- ✅ 用户提到微信/闲鱼语音消息，并且有可拿到的音频文件路径
- ✅ 用户拖入 / 提供音频文件路径
- ✅ 上下文里有 `[语音消息·未配置语音服务商]` 这类占位 → 引导用户配置后再调

### 何时不要调
- ❌ 用户只是聊"语音功能"概念 — 直接回答，不要随机抓个文件去转
- ❌ 用户给的是文字描述音频内容 — 不需要转写
- ❌ 视频文件 — 当前只支持纯音频，先告知用户用 ffmpeg 抽音轨

## 收费透明（关键）

返回中含 `charged_amount`（元）和 `duration_seconds`。**只要 charged_amount > 0，必须主动告诉用户花了多少钱**：

> "已转写完成（音频 1 分 23 秒，本次扣费 ¥0.033）"

不要悄悄扣费不告知。

## 错误处理

### `SPEECH_PROVIDER_NOT_CONFIGURED`
返回 `{ ok: false, code: 'SPEECH_PROVIDER_NOT_CONFIGURED', settings_url: '/settings#speech' }`：

回复用户：
> "需要先配置语音服务商。请打开 [设置 → 服务商 → 语音](/settings#speech) 配置火山引擎账号后再试。"

**不要**自己模拟转写、不要编内容。

### `INSUFFICIENT_BALANCE`
账户余额不足。回复：
> "账户余额不足，请先充值后再转写音频。"

### 静音音频（`text` 为空且 `empty: true`）
ASR 没检测到人声。如实告诉用户：
> "音频中未检测到人声内容（可能是静音段或纯背景音）。"

不要编内容、不要瞎猜。

### 其他失败
把原 error message 透传给用户，不要包装成"转写成功 + 空内容"。

## 示例

用户：「~/Downloads/voice.amr 这条录音说什么」

调用：
```json
{
  "tool": "transcribe_audio",
  "arguments": { "file_path": "/Users/.../Downloads/voice.amr" }
}
```

返回：
```json
{
  "ok": true,
  "text": "你好我想问一下这件商品还有现货吗",
  "duration_seconds": 4.2,
  "charged_amount": 0.0017,
  "provider": "volcengine-asr-v2"
}
```

回复用户：
> "买家在问你商品是否还有现货：『你好我想问一下这件商品还有现货吗』。
> （音频 4.2 秒，本次扣费 ¥0.002）"
