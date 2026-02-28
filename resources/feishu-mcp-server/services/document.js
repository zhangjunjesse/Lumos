/**
 * 飞书文档操作服务
 * 读取、编辑、追加、创建文档
 */
import { feishuFetch, resolveDocumentId, getAllBlocks } from './feishu-api.js';
import { extractBlockText } from '../utils/helpers.js';

/**
 * 从 TableCell 子块中提取文本
 */
function extractCellText(cellBlockId, blockMap) {
  const cell = blockMap.get(cellBlockId);
  if (!cell || !cell.children) return '';
  return cell.children
    .map(childId => extractBlockText(blockMap.get(childId)))
    .filter(Boolean)
    .join(' ');
}

/**
 * Table 块转 Markdown 表格
 */
function buildTableMarkdown(block, blockMap) {
  const { column_size, row_size } = block.table?.property || {};
  const cells = block.table?.cells || [];
  if (!column_size || !row_size || cells.length === 0) return [];

  const lines = [];
  for (let r = 0; r < row_size; r++) {
    const row = [];
    for (let c = 0; c < column_size; c++) {
      const cellId = cells[r * column_size + c];
      const text = cellId ? extractCellText(cellId, blockMap) : '';
      row.push(text.replace(/\|/g, '\\|') || ' ');
    }
    lines.push(`| ${row.join(' | ')} |`);
    if (r === 0) {
      lines.push(`|${row.map(() => '---').join('|')}|`);
    }
  }
  return lines;
}

/**
 * 块列表转 Markdown
 */
export function buildMarkdownContent(blocks) {
  const parts = [];
  let orderedIndex = 1;
  let lastBlockType = 0;
  const blockMap = new Map();
  for (const b of blocks) blockMap.set(b.block_id, b);

  // 收集表格子块 ID，跳过它们
  const skipIds = new Set();
  for (const b of blocks) {
    if (b.block_type === 31 && b.children) {
      for (const childId of b.children) {
        skipIds.add(childId);
        const child = blockMap.get(childId);
        if (child?.children) child.children.forEach(id => skipIds.add(id));
      }
    }
  }

  for (const block of blocks) {
    if (skipIds.has(block.block_id)) continue;
    const bt = block.block_type;
    const text = extractBlockText(block);

    if (bt !== 13 && lastBlockType === 13) orderedIndex = 1;

    if (bt === 31) {
      const tableLines = buildTableMarkdown(block, blockMap);
      if (tableLines.length) { parts.push('', ...tableLines, ''); }
    } else if (bt >= 3 && bt <= 11 && text) {
      parts.push(`${'#'.repeat(bt - 2)} ${text}`, '');
    } else if (bt === 2 && text) {
      parts.push(text, '');
    } else if (bt === 12 && text) {
      parts.push(`- ${text}`);
    } else if (bt === 13 && text) {
      parts.push(`${orderedIndex}. ${text}`);
      orderedIndex++;
    } else if (bt === 14 && text) {
      parts.push('```', text, '```', '');
    } else if (bt === 15 && text) {
      parts.push(`> ${text}`, '');
    } else if (bt === 27 && block.image?.token) {
      parts.push(`[图片: ${block.image.token}]`, '');
    } else if (bt === 22) {
      parts.push('---', '');
    }
    lastBlockType = bt;
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 读取文档内容（含图片映射）
 */
export async function readDocument(parsed, format = 'markdown') {
  const { documentId, title } = await resolveDocumentId(parsed);
  const blocks = await getAllBlocks(documentId, documentId);

  // 构建图片映射
  const imageMap = {};
  let imageIndex = 1;
  for (const b of blocks) {
    if (b.block_type === 27 && b.image?.token) {
      imageMap[`图片${imageIndex}`] = b.image.token;
      imageIndex++;
    }
  }

  const content = format === 'markdown'
    ? buildMarkdownContent(blocks)
    : blocks.map(b => extractBlockText(b)).filter(Boolean).join('\n');

  const blocksWithText = blocks.map(b => ({
    block_id: b.block_id,
    block_type: b.block_type,
    text: extractBlockText(b)
  })).filter(b => b.text);

  return { title, content, documentId, imageMap, blocks: blocksWithText };
}

/**
 * 获取文档块列表
 */
export async function getBlocks(parsed) {
  const { documentId } = await resolveDocumentId(parsed);
  const blocks = await getAllBlocks(documentId, documentId);
  const blocksWithText = blocks.map(b => ({
    block_id: b.block_id,
    block_type: b.block_type,
    text: extractBlockText(b)
  })).filter(b => b.text);
  return { documentId, blocks: blocksWithText };
}

/**
 * 追加文本到文档末尾
 */
export async function appendToDocument(parsed, content) {
  const { documentId } = await resolveDocumentId(parsed);

  // 获取文档 revision
  const docMeta = await feishuFetch(`/docx/v1/documents/${documentId}`);
  const revisionId = docMeta.document.revision_id;

  const path = `/docx/v1/documents/${documentId}/blocks/${documentId}/children?document_revision_id=${revisionId}`;
  await feishuFetch(path, {
    method: 'POST',
    body: JSON.stringify({
      children: [{
        block_type: 2,
        text: { elements: [{ text_run: { content } }] }
      }]
    })
  });

  return { success: true, message: '内容已追加到文档末尾' };
}

/**
 * 更新指定块的内容
 */
export async function updateBlock(parsed, blockId, newContent) {
  const { documentId } = await resolveDocumentId(parsed);

  // 获取块信息以找到父块
  const blockInfo = await feishuFetch(
    `/docx/v1/documents/${documentId}/blocks/${blockId}`
  );
  const parentId = blockInfo.block.parent_id;

  // 获取块在父块中的索引
  const childrenData = await feishuFetch(
    `/docx/v1/documents/${documentId}/blocks/${parentId}/children`
  );
  let blockIndex = 0;
  if (childrenData.items) {
    blockIndex = childrenData.items.findIndex(item => item.block_id === blockId);
    if (blockIndex < 0) blockIndex = 0;
  }

  // 插入新文本块
  const newBlock = {
    block_type: 2,
    text: { elements: [{ text_run: { content: newContent } }] }
  };
  const createPath = `/docx/v1/documents/${documentId}/blocks/${parentId}/children?document_revision_id=-1`;
  await feishuFetch(createPath, {
    method: 'POST',
    body: JSON.stringify({ children: [newBlock], index: blockIndex })
  });

  // 删除旧块
  const deletePath = `/docx/v1/documents/${documentId}/blocks/${parentId}/children/batch_delete?document_revision_id=-1`;
  await feishuFetch(deletePath, {
    method: 'DELETE',
    body: JSON.stringify({
      start_index: blockIndex + 1,
      end_index: blockIndex + 2
    })
  });

  return { success: true, message: '内容已更新' };
}

/**
 * 覆盖文档全部内容
 */
export async function overwriteDocument(parsed, markdown) {
  const { documentId } = await resolveDocumentId(parsed);

  // 获取所有子块
  const childrenData = await feishuFetch(
    `/docx/v1/documents/${documentId}/blocks/${documentId}/children`
  );
  const children = childrenData.items || [];

  // 删除所有现有子块
  if (children.length > 0) {
    const deletePath = `/docx/v1/documents/${documentId}/blocks/${documentId}/children/batch_delete?document_revision_id=-1`;
    await feishuFetch(deletePath, {
      method: 'DELETE',
      body: JSON.stringify({ start_index: 0, end_index: children.length })
    });
  }

  // 将 markdown 按行拆分为文本段落块写入
  const lines = markdown.split('\n').filter(l => l.trim());
  const blocks = lines.map(line => ({
    block_type: 2,
    text: { elements: [{ text_run: { content: line } }] }
  }));

  if (blocks.length > 0) {
    await batchAppendBlocks(documentId, documentId, blocks);
  }

  return { success: true, message: '文档内容已覆盖更新' };
}

/**
 * 分批追加块（飞书 API 单次最多 50 个）
 */
async function batchAppendBlocks(documentId, parentId, blocks) {
  const BATCH = 50;
  for (let i = 0; i < blocks.length; i += BATCH) {
    if (i > 0) await new Promise(r => setTimeout(r, 300));
    const batch = blocks.slice(i, i + BATCH);
    const path = `/docx/v1/documents/${documentId}/blocks/${parentId}/children?document_revision_id=-1`;
    await feishuFetch(path, {
      method: 'POST',
      body: JSON.stringify({ children: batch })
    });
  }
}

/**
 * 创建新文档
 */
export async function createDocument(title, content, folderToken) {
  const data = await feishuFetch('/docx/v1/documents', {
    method: 'POST',
    body: JSON.stringify({ title, folder_token: folderToken || '' })
  });

  const documentId = data.document.document_id;
  const docDomain = process.env.FEISHU_DOC_DOMAIN || 'https://xingetech.feishu.cn';
  const url = `${docDomain}/docx/${documentId}`;

  // 写入初始内容
  if (content) {
    const blocks = content.split('\n').filter(l => l.trim()).map(line => ({
      block_type: 2,
      text: { elements: [{ text_run: { content: line } }] }
    }));
    if (blocks.length > 0) {
      await batchAppendBlocks(documentId, documentId, blocks);
    }
  }

  return { success: true, documentId, url, message: `文档已创建: ${title}` };
}
