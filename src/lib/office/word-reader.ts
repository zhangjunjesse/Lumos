import mammoth from 'mammoth';
import fs from 'fs';

export interface ReadWordResult {
  fileName: string;
  text: string;
  html: string;
  messages: string[];
}

export async function readWord(filePath: string): Promise<ReadWordResult> {
  const buffer = fs.readFileSync(filePath);

  const [textResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer }),
  ]);

  const messages = [
    ...textResult.messages.map((m) => m.message),
    ...htmlResult.messages.map((m) => m.message),
  ];

  return {
    fileName: filePath.split('/').pop() || filePath,
    text: textResult.value,
    html: htmlResult.value,
    messages: [...new Set(messages)],
  };
}
