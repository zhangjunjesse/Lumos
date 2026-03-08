import { NextRequest, NextResponse } from 'next/server';
import { loadToken } from '@/lib/feishu-auth';

const FEISHU_BASE_URL = 'https://open.feishu.cn/open-apis';
const TYPE_PATH: Record<string, string> = {
  doc: 'doc',
  docx: 'docx',
  sheet: 'sheets',
  bitable: 'base',
  wiki: 'wiki',
};

interface FeishuDriveFile {
  token?: string;
  node_token?: string;
  obj_token?: string;
  name?: string;
  title?: string;
  type?: string;
  obj_type?: string;
  url?: string;
  modified_time?: string;
  edit_time?: string;
  file_extension?: string;
  mime_type?: string;
}

function buildDocUrl(type: string, token: string): string {
  const seg = TYPE_PATH[type];
  if (!seg || !token) return '';
  return `https://feishu.cn/${seg}/${token}`;
}

export async function GET(req: NextRequest) {
  try {
    const token = loadToken();
    if (!token) {
      return NextResponse.json(
        { error: 'FEISHU_AUTH_REQUIRED', message: '请先登录飞书账号' },
        { status: 401 },
      );
    }
    if (Date.now() > token.expiresAt) {
      return NextResponse.json(
        { error: 'FEISHU_AUTH_EXPIRED', message: '飞书登录已过期，请重新登录' },
        { status: 401 },
      );
    }

    const pageToken = req.nextUrl.searchParams.get('pageToken');
    const q = req.nextUrl.searchParams.get('q')?.trim() || '';
    const folderToken = req.nextUrl.searchParams.get('folderToken')?.trim() || '';
    const view = req.nextUrl.searchParams.get('view')?.trim() || '';
    const scope = req.nextUrl.searchParams.get('scope')?.trim() || 'my';
    const isDriveView = view === 'drive';

    if (q) {
      const response = await fetch(`${FEISHU_BASE_URL}/suite/docs-api/search/object`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.userAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          search_key: q,
          count: 50,
          offset: 0,
          doc_types: ['doc', 'docx', 'sheet', 'bitable', 'wiki'],
        }),
      });

      const data = await response.json() as {
        code?: number;
        msg?: string;
        data?: {
          docs_entities?: Array<{
            docs_token?: string;
            title?: string;
            docs_type?: string;
            url?: string;
            edit_time?: number;
          }>;
          has_more?: boolean;
        };
      };

      if (!response.ok || data.code !== 0) {
        return NextResponse.json(
          {
            error: 'FEISHU_API_ERROR',
            message: data.msg || `飞书搜索请求失败 (${response.status})`,
          },
          { status: 500 },
        );
      }

      const items = (data.data?.docs_entities || [])
        .map((doc) => {
          const tokenValue = doc.docs_token || '';
          const type = doc.docs_type || 'doc';
          return {
            token: tokenValue,
            title: doc.title || 'Untitled',
            type,
            url: doc.url || buildDocUrl(type, tokenValue),
            updatedTime: doc.edit_time || 0,
            isFolder: false,
            isFile: false,
          };
        })
        .filter((item) => !!item.token && !!item.url);

      return NextResponse.json({
        items,
        hasMore: !!data.data?.has_more,
        pageToken: null,
      });
    }

    const params = new URLSearchParams({
      page_size: '50',
      order_by: 'EditedTime',
      direction: 'DESC',
    });
    if (pageToken) {
      params.set('page_token', pageToken);
    }
    let resolvedFolderToken = folderToken;
    const sharedFallback = scope === 'shared' && !resolvedFolderToken;
    if (sharedFallback) {
      resolvedFolderToken = 'shared';
    }
    if (resolvedFolderToken) {
      params.set('folder_token', resolvedFolderToken);
    }

    const response = await fetch(`${FEISHU_BASE_URL}/drive/v1/files?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token.userAccessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json() as {
      code?: number;
      msg?: string;
      data?: {
        files?: FeishuDriveFile[];
        has_more?: boolean;
        page_token?: string;
      };
    };

    if (!response.ok || data.code !== 0) {
      if (sharedFallback) {
        return NextResponse.json({
          items: [],
          hasMore: false,
          pageToken: null,
          needsSharedFolder: true,
          message: data.msg || '共享文件夹需要提供具体链接或 Token',
        });
      }
      return NextResponse.json(
        {
          error: 'FEISHU_API_ERROR',
          message: data.msg || `飞书接口请求失败 (${response.status})`,
        },
        { status: 500 },
      );
    }

    const docTypes = new Set(['doc', 'docx', 'sheet', 'bitable', 'wiki']);
    const driveTypes = new Set(['folder', 'file', ...docTypes]);
    const files = data.data?.files || [];
    const items = files
      .map((file) => {
        const tokenValue = file.token || file.node_token || file.obj_token || '';
        const type = file.type || file.obj_type || 'doc';
        const title = file.name || file.title || 'Untitled';
        const url = file.url || (docTypes.has(type) ? buildDocUrl(type, tokenValue) : '');
        return {
          token: tokenValue,
          title,
          type,
          url,
          updatedTime: parseInt(file.modified_time || file.edit_time || '0', 10) || 0,
          isFolder: type === 'folder',
          isFile: type === 'file',
          fileExtension: file.file_extension || undefined,
          mimeType: file.mime_type || undefined,
        };
      })
      .filter((item) => {
        if (!item.token) return false;
        if (isDriveView) {
          return driveTypes.has(item.type);
        }
        return docTypes.has(item.type) && !!item.url;
      });

    return NextResponse.json({
      items,
      hasMore: !!data.data?.has_more,
      pageToken: data.data?.page_token || null,
      needsSharedFolder: sharedFallback && items.length === 0,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch Feishu docs';
    return NextResponse.json({ error: 'INTERNAL_ERROR', message }, { status: 500 });
  }
}
