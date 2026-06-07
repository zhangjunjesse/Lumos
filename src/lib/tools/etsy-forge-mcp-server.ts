// 主 agent 的 Etsy 出图工具(in-process MCP)。微信发图/商品链接 + 触发词 → agent 调这个工具,
// 把一张源图做成「我的产品」里一张二创产品图(建手攒产品 → 按方向二创 → 锁色合成默认空白 T)。
// 商品链接(淘宝/小红书)由 agent 先用浏览器后台抓主图、再把图路径/直链传进来——本工具不抓网页。
// 低风险:只生成草稿,不上架/不传 Printful。失败如实返回,不伪造。

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { getEtsyForgeStore, getEtsyForgeUserId } from '@/lib/etsy-forge/store';
import { makeProductFromImage } from '@/lib/etsy-forge/image-to-product';

export const ETSY_FORGE_MCP_SERVER_NAME = 'lumos-etsy-forge';

export const ETSY_FORGE_MCP_SYSTEM_HINT = `You have a built-in Etsy product tool (server \`lumos-etsy-forge\`):
- \`mcp__lumos-etsy-forge__make_etsy_product_from_image({ image_path?, image_url?, name? })\`: turn ONE source image into a new remixed (二创) Etsy product mockup, saved to the app's 我的产品. It does NOT publish/list anything (draft only).

When to use: the user sends an image (e.g. a WeChat photo) or a 淘宝/小红书 product LINK and asks to make an Etsy 二创 product.
- For an image attachment: pass its local path as \`image_path\`.
- For a 淘宝/小红书/etc product LINK: first use your browser tools in BACKGROUND mode to open the link and grab the main product image (download it locally), then pass that local path / direct image url here. This tool does not fetch web pages itself; if the image can't be obtained, tell the user honestly — do not fabricate.
After success, tell the user it's done (1 product image) and to check 我的产品.`;

interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}
const jsonResult = (data: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const errorResult = (e: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }) }],
  isError: true,
});

export function createEtsyForgeMcpServer() {
  return createSdkMcpServer({
    name: ETSY_FORGE_MCP_SERVER_NAME,
    tools: [createMakeProductTool()],
  });
}

function createMakeProductTool() {
  return tool(
    'make_etsy_product_from_image',
    'Turn ONE source image into a new remixed (二创) Etsy product mockup in the app\'s 我的产品. ' +
      'Input: a local image path (image_path, e.g. a WeChat image attachment) OR a direct image http(s) URL (image_url). ' +
      'For a 淘宝/小红书 product PAGE link, first use your browser tools (background) to grab the main image, then pass that here — this tool does not fetch web pages. ' +
      'Creates a manual product, remixes the image into a new print, prints it onto the default blank tee, and saves to 我的产品. Draft only — does not publish or list. ' +
      'On success tell the user it is done and to check 我的产品; on failure report the reason honestly.',
    {
      image_path: z.string().optional().describe('Absolute local path to the source image (WeChat attachment path, or a browser-downloaded image file).'),
      image_url: z.string().optional().describe('Direct http(s) URL of the source IMAGE (not a product page link).'),
      name: z.string().optional().describe('Optional product name shown in 我的产品.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        if (!args.image_path && !args.image_url) {
          return errorResult('需要 image_path 或 image_url(商品链接请先用浏览器后台抓到主图,再把图传进来)');
        }
        const r = await makeProductFromImage(getEtsyForgeStore(), getEtsyForgeUserId(), {
          imagePath: args.image_path,
          imageUrl: args.image_url,
          productName: args.name,
        });
        return jsonResult(
          r.ok
            ? { ok: true, product_id: r.productId, message: '已生成 1 张二创产品图,挂到「我的产品」', verify_in_ui: 'Etsy 选品采集 → 我的产品' }
            : { ok: false, error: r.error, verify_in_ui: 'Etsy 选品采集 → 我的产品' },
        );
      } catch (e) {
        return errorResult(e);
      }
    },
  );
}
