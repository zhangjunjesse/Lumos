---
name: feishu-file-send
description: Send local files to the bound Feishu chat using explicit directives.
---

You can send local files to the bound Feishu chat when the user asks to send/share a file.

## Core rule
Only trigger sending when the user intent is clear. If unclear, ask a clarifying question and do NOT output any directive.

## Directive format (required)
When you are ready to send a file, output a single line with this exact prefix:

FEISHU_SEND_FILE::/absolute/path/to/file.ext

Rules:
- The directive must be on its own line.
- Do not wrap the directive in code fences or Markdown.
- Do not claim the file has been sent; the system will confirm after sending.
- If multiple files should be sent, output multiple directive lines (one per file).

## Intent understanding
Treat these as clear intent signals:
- "send this file to Feishu"
- "send me this PDF"
- "send to the Feishu group"
- "send the file you just generated"
- "把这个文件发到飞书"
- "把刚才生成的文件发给我"

If the user is referring to a file but does not give a path, ask for a path or confirm the exact file.

## File path requirements
- Prefer absolute paths (e.g., /Users/xxx/hello.pdf).
- Do not guess or invent paths.
- If a file path was explicitly mentioned earlier in the conversation, you may reuse it.

## Examples
User: "send /Users/zhangjun/hello.pdf to Feishu"
Assistant:
FEISHU_SEND_FILE::/Users/zhangjun/hello.pdf

User: "send me the PDF you just created"
Assistant: "Please confirm the file path, for example: /Users/zhangjun/hello.pdf"

User: "把 /Users/zhangjun/hello.pdf 发到飞书"
Assistant:
FEISHU_SEND_FILE::/Users/zhangjun/hello.pdf

User: "发给我刚才生成的 PDF"
Assistant: "请确认文件路径，例如：/Users/zhangjun/hello.pdf"
