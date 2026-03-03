/**
 * Browser Context Menu
 * 浏览器右键菜单，支持分享到 AI
 */

import { BrowserWindow, Menu, MenuItem, WebContentsView } from 'electron';

export interface ContextMenuOptions {
  onShareToAI?: (content: string, type: 'text' | 'link' | 'image') => void;
}

export function setupBrowserContextMenu(
  view: WebContentsView,
  options: ContextMenuOptions = {}
): void {
  view.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();

    // 如果有选中文本
    if (params.selectionText) {
      menu.append(
        new MenuItem({
          label: 'Share selected text to AI',
          click: () => {
            if (options.onShareToAI) {
              options.onShareToAI(params.selectionText, 'text');
            }
          },
        })
      );
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // 如果是链接
    if (params.linkURL) {
      menu.append(
        new MenuItem({
          label: 'Share link to AI',
          click: () => {
            if (options.onShareToAI) {
              options.onShareToAI(params.linkURL, 'link');
            }
          },
        })
      );
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // 如果是图片
    if (params.mediaType === 'image' && params.srcURL) {
      menu.append(
        new MenuItem({
          label: 'Share image to AI',
          click: () => {
            if (options.onShareToAI) {
              options.onShareToAI(params.srcURL, 'image');
            }
          },
        })
      );
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // 标准菜单项
    if (params.selectionText) {
      menu.append(
        new MenuItem({
          label: 'Copy',
          role: 'copy',
        })
      );
    }

    if (params.editFlags.canPaste) {
      menu.append(
        new MenuItem({
          label: 'Paste',
          role: 'paste',
        })
      );
    }

    if (params.linkURL) {
      menu.append(
        new MenuItem({
          label: 'Copy link',
          click: () => {
            const { clipboard } = require('electron');
            clipboard.writeText(params.linkURL);
          },
        })
      );
    }

    // 开发者工具
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(
      new MenuItem({
        label: 'Inspect Element',
        click: () => {
          view.webContents.inspectElement(params.x, params.y);
        },
      })
    );

    if (menu.items.length > 0) {
      menu.popup();
    }
  });
}
