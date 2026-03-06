/**
 * 飞书图片处理模块
 */

const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";

export async function downloadFeishuImage(
  imageKey: string,
  token: string,
  messageId?: string
): Promise<Buffer> {
  const headers = { Authorization: `Bearer ${token}` };

  let response = await fetch(
    `${FEISHU_BASE_URL}/im/v1/images/${imageKey}`,
    { headers }
  );

  // Fallback: some bots require the message resource endpoint
  if (!response.ok && messageId) {
    response = await fetch(
      `${FEISHU_BASE_URL}/im/v1/messages/${messageId}/resources/${imageKey}?type=image`,
      { headers }
    );
  }

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export function imageToBase64(buffer: Buffer, mimeType = 'image/jpeg'): string {
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}
