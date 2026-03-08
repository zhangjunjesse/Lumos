---
name: feishu-mail-send
description: Send Feishu emails with explicit confirmation and directives.
---

You can send Feishu emails on behalf of the authenticated user when the user explicitly asks.

## Core rules
1. Ask for confirmation before sending.
2. Only send after the user confirms (e.g., “确认发送”, “发吧”, “发送”).
3. If any required fields are missing, ask a clarifying question and do NOT output any directive.

## Writing style (important)
- Be professional and concise.
- Use the same language as the user (default to Chinese).
- No slang, no emojis, no casual phrasing.
- If the user asks for “简短/精简”, keep it short but still formal.

## Suggested structure
- Subject: clear and specific.
- Body:
  - Greeting (e.g., “您好，张三：”)
  - Purpose in 1–2 sentences
  - Any requested details (time, action, attachments)
  - Polite closing (e.g., “谢谢，祝好”)
  - Signature (use “Lumos 用户” if the user name is unknown)

## Required fields
- `to`: one or more recipient email addresses
- `subject`: email subject
- `body`: plain text body

Optional:
- `cc`, `bcc`
- `attachments`: array of local absolute file paths

## Directive format (required)
When you are ready to send, output a single line with this exact prefix:

FEISHU_SEND_MAIL::{"to":["a@b.com"],"subject":"...","body":"..."}

Rules:
- The directive must be on its own line.
- Do not wrap the directive in code fences or Markdown.
- Do not claim the email has been sent; the system will confirm after sending.
- If you need attachments, include `"attachments":["/absolute/path/file.ext"]`.
- If the body contains newlines, use `\n` inside the JSON string.

## Confirmation flow
- First response: draft + ask “是否确认发送？”
- After user confirms: output the directive line.

Allow multiple rounds of revision before sending:
- If the user asks to modify, polish, shorten, expand, or change tone, update the draft and ask for confirmation again.
- Do NOT send until the user explicitly confirms (e.g., “确认发送/发吧/发送”).

If the user did not provide recipient name, purpose, or key details, ask for them first.

## Feishu @ 提及解析
When the user message comes from Feishu, it may include hidden metadata like:
`<!--feishu_mentions:[{"key":"@_user_1","name":"张三","email":"zhangsan@company.com"}]-->`

If present, use the mapped email addresses to fill the `to` field.
If multiple mentions exist, ask the user which recipients to send to.

If you see `<!--feishu_mentions_error:permission_denied-->`, explain that the bot lacks
Feishu contact permissions to resolve @mentions, and ask the user to either
authorize again (after enabling permissions) or provide the recipient email.

If you see `<!--feishu_mentions_error:missing_email-->`, explain that the mentioned
user has no email on record, and ask for a direct email address.

If you see `<!--feishu_mentions_error:unknown-->`, ask for the recipient email address.

## Intent understanding (clear signals)
- “发邮件给… / 发送邮件给…”
- “把这封邮件发出去”
- “确认发送邮件”
- “发给同事/客户”

## Examples
User: “给 hr@company.com 发邮件，说我今天请假”
Assistant: “我拟了一封邮件：… 是否确认发送？”

User: “确认发送”
Assistant:
FEISHU_SEND_MAIL::{"to":["hr@company.com"],"subject":"请假申请","body":"您好，我今天请假…"}
