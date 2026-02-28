/**
 * 飞书 HTTP 请求封装
 * 统一处理认证头、错误处理、分页
 */
import { getToken, BASE_URL } from './auth.js';

/**
 * 发送飞书 API 请求
 */
export async function feishuFetch(path, opts = {}) {
  const token = await getToken();
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...opts.headers
    }
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(data.msg || `飞书 API 错误 (code=${data.code})`);
  }
  return data.data;
}

/**
 * 解析 URL 并获取真实 documentId（wiki 需要额外查询）
 */
export async function resolveDocumentId(parsed) {
  let documentId = parsed.docId;
  let title = '';

  if (parsed.type === 'wiki') {
    const data = await feishuFetch(
      `/wiki/v2/spaces/get_node?token=${parsed.docId}`
    );
    documentId = data.node.obj_token;
    title = data.node.title || '';
  } else if (parsed.type === 'docx') {
    try {
      const data = await feishuFetch(`/docx/v1/documents/${documentId}`);
      title = data.document?.title || '';
    } catch { /* ignore */ }
  }

  return { documentId, title };
}

/**
 * 递归获取文档所有块
 */
export async function getAllBlocks(documentId, parentBlockId, allBlocks = []) {
  let pageToken = '';
  let hasMore = true;

  while (hasMore) {
    let path = `/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children?page_size=50`;
    if (pageToken) path += `&page_token=${pageToken}`;

    let data;
    try {
      data = await feishuFetch(path);
    } catch {
      break;
    }

    const items = data.items || [];
    for (const block of items) {
      allBlocks.push(block);
      if (block.children && block.children.length > 0) {
        await getAllBlocks(documentId, block.block_id, allBlocks);
      }
    }

    hasMore = data.has_more || false;
    pageToken = data.page_token || '';
  }

  return allBlocks;
}
