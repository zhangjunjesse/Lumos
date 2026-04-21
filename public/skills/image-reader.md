---
name: image-reader
description: Load image files into the conversation so the vision model can actually see them
---

# 图片阅读 / Image Reader

当任务需要你"看"一张图片——分析电商图、描述照片、OCR、对比产出图、基于参考图继续创作等——用 `image-reader` MCP 的 `read_image` 工具。**不要**用 `Read` / `read_file` / `read_media_file` 或任何通用文件读取工具读图片，它们只会返回一大段 base64 文本，你看不到真正的图像。

## 可用工具

### read_image
- 输入: `{ path: string }` — 图片文件的绝对路径，或相对于当前 workspace 的路径
- 输出: 一个 `image` content block（你会真正看到这张图）+ 一行加载状态文本
- 支持格式: `.jpg` / `.jpeg` / `.png` / `.webp` / `.gif`
- 单图上限: 4MB（超出先压缩或缩放到长边 ≤1568px）

## 使用规则

- ✅ 要理解图片语义、分析内容、做视觉推理 → `read_image`
- ✅ 要把图片作为参考传给下游步骤（例如 `mcp__lumos-image__generate_image` 的参考图）→ `read_image`
- ❌ 只是要把图片复制到另一个路径 → `Bash cp`
- ❌ 只需要元数据（尺寸、EXIF、mime）→ 用专门的元数据工具或 `Bash file`

## 常见错误

| 报错 | 原因 | 解法 |
|---|---|---|
| `Unsupported image type` | 格式不在支持列表（如 heic/bmp） | 先用系统工具转成 jpg/png |
| `Image too large` | 文件 > 4MB | 压缩或缩放后再读；Claude vision 硬上限 ~5MB 基本等价于此 |
| `Cannot access` | 路径错 / 权限不够 / 跨分区 | 检查绝对路径是否正确、文件是否存在 |
