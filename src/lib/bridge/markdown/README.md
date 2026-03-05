# Markdown to Feishu Card Converter

## Usage

```typescript
import { markdownToFeishuCard } from '@/lib/bridge/markdown';

const card = markdownToFeishuCard('## Hello\n\nThis is **bold** text.', {
  title: '🤖 AI Response',
  headerColor: 'blue',
});

// Send to Feishu
await feishuClient.im.message.create({
  receive_id_type: 'chat_id',
  receive_id: chatId,
  msg_type: 'interactive',
  content: JSON.stringify(card),
});
```

## Features

- Headings, paragraphs, code blocks, lists, blockquotes, hr
- Inline formatting: bold, italic, code, links
- Code syntax highlighting
- Card splitting for large content
