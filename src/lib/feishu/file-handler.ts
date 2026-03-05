/**
 * 飞书文件处理模块
 */

const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";

export async function downloadFeishuFile(
  fileKey: string,
  messageId: string,
  token: string
): Promise<Buffer> {
  const response = await fetch(
    `${FEISHU_BASE_URL}/im/v1/messages/${messageId}/resources/${fileKey}?type=file`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function extractTextFromFile(
  buffer: Buffer,
  fileType: string
): Promise<string> {
  switch (fileType.toLowerCase()) {
    case 'txt':
    case 'md':
      return buffer.toString('utf-8');
    case 'pdf':
    case 'docx':
    case 'xlsx':
      return `[${fileType.toUpperCase()} 文件内容，需要专门的解析库]`;
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}
