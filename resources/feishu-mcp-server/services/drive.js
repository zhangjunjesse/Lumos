/**
 * 飞书云盘与搜索服务
 */
import { feishuFetch } from './feishu-api.js';

const DOC_DOMAIN = process.env.FEISHU_DOC_DOMAIN || 'https://xingetech.feishu.cn';
const TYPE_PATH = { doc: 'doc', docx: 'docx', sheet: 'sheets', bitable: 'base', wiki: 'wiki' };

function buildUrl(type, token) {
  const seg = TYPE_PATH[type];
  return seg && token ? `${DOC_DOMAIN}/${seg}/${token}` : '';
}

function normalize(item) {
  return {
    token: item.token || item.node_token || item.obj_token || '',
    title: item.name || item.title || '未命名',
    type: item.type || item.obj_type || 'doc',
    url: item.url || '',
    updatedTime: parseInt(item.modified_time || item.edit_time) || 0,
    createdTime: parseInt(item.created_time || item.create_time) || 0
  };
}

/**
 * 列出云盘文件
 */
export async function listFiles(folderToken, pageToken, orderBy, direction) {
  const params = new URLSearchParams({ folder_token: folderToken || '', page_size: '20' });
  if (pageToken) params.set('page_token', pageToken);
  if (orderBy) {
    params.set('order_by', orderBy);
    params.set('direction', direction || 'DESC');
  }
  const data = await feishuFetch(`/drive/v1/files?${params}`);
  return {
    items: (data.files || []).map(normalize),
    pageToken: data.page_token || null,
    hasMore: !!data.has_more
  };
}

/**
 * 搜索文件
 */
export async function searchFiles(query, scope, pageToken) {
  const offset = parseInt(pageToken) || 0;
  const body = {
    search_key: query,
    count: 20,
    offset,
    doc_types: ['doc', 'docx', 'sheet', 'wiki']
  };

  const data = await feishuFetch('/suite/docs-api/search/object', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  const items = (data.docs_entities || []).map(d => ({
    token: d.docs_token || '',
    title: d.title || '未命名',
    type: d.docs_type || 'doc',
    url: d.url || buildUrl(d.docs_type, d.docs_token),
    updatedTime: d.edit_time || 0,
    createdTime: d.create_time || 0
  }));

  return {
    items,
    pageToken: data.has_more ? String(offset + items.length) : null,
    hasMore: !!data.has_more
  };
}

/**
 * 列出 Wiki 空间
 */
export async function listWikiSpaces(pageToken) {
  const params = new URLSearchParams({ page_size: '20' });
  if (pageToken) params.set('page_token', pageToken);
  const data = await feishuFetch(`/wiki/v2/spaces?${params}`);
  return {
    items: (data.items || []).map(s => ({
      token: s.space_id,
      title: s.name || '未命名空间',
      type: 'wiki_space',
      url: '',
      updatedTime: 0
    })),
    pageToken: data.page_token || null,
    hasMore: !!data.has_more
  };
}
