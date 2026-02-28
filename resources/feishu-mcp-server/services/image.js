/**
 * 飞书图片操作服务
 */
import { getToken, BASE_URL } from './auth.js';
import { feishuFetch, resolveDocumentId, getAllBlocks } from './feishu-api.js';

/**
 * 下载图片并转为 base64
 */
export async function downloadImage(imageToken) {
  const token = await getToken();
  const url = `${BASE_URL}/drive/v1/medias/${imageToken}/download`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error(`图片下载失败: HTTP ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const contentType = res.headers.get('content-type') || 'image/png';

  return {
    base64,
    contentType,
    dataUrl: `data:${contentType};base64,${base64}`
  };
}

/**
 * 获取文档中的图片列表
 */
export async function getImageList(parsed) {
  const { documentId } = await resolveDocumentId(parsed);
  const blocks = await getAllBlocks(documentId, documentId);

  const images = blocks
    .filter(b => b.block_type === 27 && b.image?.token)
    .map(b => ({
      block_id: b.block_id,
      token: b.image.token,
      width: b.image.width,
      height: b.image.height
    }));

  return { documentId, images };
}
