import fs from 'fs';
import os from 'os';
import path from 'path';

import { parseApp } from '../../manifest/parser';
import { validateApp } from '../../manifest/validator';
import { promoteWorkflowToApp, type PromoteRequest } from '../promote';

function makeReq(overrides: Partial<PromoteRequest> = {}): PromoteRequest {
  return {
    appId: 'demo-app',
    appName: 'Demo',
    workflow: {
      id: 'main',
      name: 'Main',
      inputs: [
        { name: 'topic', type: 'string', required: true, label: '主题' },
        { name: 'count', type: 'number' },
      ],
      outputs: [{ name: 'report', type: 'markdown' }],
      body: { params: [], nodes: [], edges: [] },
    },
    outDir: '',
    ...overrides,
  };
}

describe('promoteWorkflowToApp', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-promote-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('produces a directory that parseApp + validateApp accept', () => {
    const out = path.join(tmp, 'app');
    promoteWorkflowToApp(makeReq({ outDir: out }));

    const parsed = parseApp(out);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const issues = validateApp(parsed.app);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('writes the expected file structure', () => {
    const out = path.join(tmp, 'app');
    promoteWorkflowToApp(makeReq({ outDir: out }));

    expect(fs.existsSync(path.join(out, 'app.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'routes.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'icon.png'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'pages', 'main.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'workflows', 'main.json'))).toBe(true);
  });

  it('maps text inputs to textarea, numbers to number, booleans to switch', () => {
    const out = path.join(tmp, 'app');
    promoteWorkflowToApp(
      makeReq({
        outDir: out,
        workflow: {
          id: 'main',
          inputs: [
            { name: 'long_text', type: 'text' },
            { name: 'qty', type: 'number' },
            { name: 'flag', type: 'boolean' },
            { name: 'choice', type: 'select', options: ['a', 'b'] },
          ],
        },
      }),
    );
    const page = JSON.parse(
      fs.readFileSync(path.join(out, 'pages', 'main.json'), 'utf-8'),
    ) as { form: Array<{ type: string; name: string }> };
    expect(page.form.find((f) => f.name === 'long_text')?.type).toBe('textarea');
    expect(page.form.find((f) => f.name === 'qty')?.type).toBe('number');
    expect(page.form.find((f) => f.name === 'flag')?.type).toBe('switch');
    expect(page.form.find((f) => f.name === 'choice')?.type).toBe('select');
  });

  it('picks the result render type from the first output', () => {
    for (const [outputType, expected] of [
      ['markdown', 'markdown'],
      ['json', 'json'],
      ['table', 'table'],
      ['string', 'text'],
      ['file', 'text'],
    ] as const) {
      const out = path.join(tmp, `app-${outputType}`);
      promoteWorkflowToApp(
        makeReq({
          outDir: out,
          workflow: {
            id: 'main',
            outputs: [{ name: 'r', type: outputType }],
          },
        }),
      );
      const page = JSON.parse(
        fs.readFileSync(path.join(out, 'pages', 'main.json'), 'utf-8'),
      ) as { submit: { render: string } };
      expect(page.submit.render).toBe(expected);
    }
  });

  it('promotes secret-shaped inputs (token/key/password) into ConfigItems', () => {
    const out = path.join(tmp, 'app');
    promoteWorkflowToApp(
      makeReq({
        outDir: out,
        workflow: {
          id: 'main',
          inputs: [
            { name: 'feishu_token', type: 'string' },
            { name: 'api_key', type: 'string' },
            { name: 'topic', type: 'string' },
          ],
        },
      }),
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(out, 'app.json'), 'utf-8'),
    ) as { config?: Array<{ key: string; secret?: boolean; type: string }> };
    expect(manifest.config?.length).toBe(2);
    expect(manifest.config?.find((c) => c.key === 'feishu_token')?.secret).toBe(true);
    expect(manifest.config?.find((c) => c.key === 'api_key')?.secret).toBe(true);
  });

  it('writes a schedule trigger when schedule is provided', () => {
    const out = path.join(tmp, 'app');
    promoteWorkflowToApp(
      makeReq({
        outDir: out,
        schedule: { cron: '0 9 * * 1', input: { mode: 'weekly' } },
      }),
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(out, 'app.json'), 'utf-8'),
    ) as { triggers: Array<{ type: string; cron?: string; workflow?: string }> };
    expect(manifest.triggers).toEqual([
      { type: 'manual' },
      expect.objectContaining({
        type: 'schedule',
        cron: '0 9 * * 1',
        workflow: 'main',
      }),
    ]);
  });

  it('detects feishu MCP usage in the workflow body', () => {
    const out = path.join(tmp, 'app');
    promoteWorkflowToApp(
      makeReq({
        outDir: out,
        workflow: {
          id: 'main',
          body: {
            nodes: [
              { id: 'n1', type: 'capability', input: { server: 'feishu', tool: 'send_message' } },
            ],
          },
        },
      }),
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(out, 'app.json'), 'utf-8'),
    ) as { requires?: { mcp?: string[] } };
    expect(manifest.requires?.mcp).toContain('feishu');
  });

  it('detects bash and python tool usage', () => {
    const out = path.join(tmp, 'app');
    promoteWorkflowToApp(
      makeReq({
        outDir: out,
        workflow: {
          id: 'main',
          body: {
            nodes: [
              { id: 'n1', type: 'agent', prompt: 'Use bash to grep, then python to analyze.' },
            ],
          },
        },
      }),
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(out, 'app.json'), 'utf-8'),
    ) as { requires?: { tools?: string[] } };
    expect(manifest.requires?.tools).toEqual(expect.arrayContaining(['bash', 'python']));
  });

  it('honors extraMcps and extraTools hints', () => {
    const out = path.join(tmp, 'app');
    promoteWorkflowToApp(
      makeReq({
        outDir: out,
        extraMcps: ['custom-mcp'],
        extraTools: ['web-fetch'],
      }),
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(out, 'app.json'), 'utf-8'),
    ) as { requires?: { mcp?: string[]; tools?: string[] } };
    expect(manifest.requires?.mcp).toContain('custom-mcp');
    expect(manifest.requires?.tools).toContain('web-fetch');
  });

  it('writes whitelist network domains when supplied', () => {
    const out = path.join(tmp, 'app');
    promoteWorkflowToApp(
      makeReq({
        outDir: out,
        networkDomains: ['open.feishu.cn'],
      }),
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(out, 'app.json'), 'utf-8'),
    ) as { permissions: { network: { mode: string; domains?: string[] } } };
    expect(manifest.permissions.network.mode).toBe('whitelist');
    expect(manifest.permissions.network.domains).toContain('open.feishu.cn');
  });

  it('defaults to network: disabled when no domains are supplied', () => {
    const out = path.join(tmp, 'app');
    promoteWorkflowToApp(makeReq({ outDir: out }));
    const manifest = JSON.parse(
      fs.readFileSync(path.join(out, 'app.json'), 'utf-8'),
    ) as { permissions: { network: { mode: string } } };
    expect(manifest.permissions.network.mode).toBe('disabled');
  });

  it('rejects malformed app id', () => {
    expect(() =>
      promoteWorkflowToApp(makeReq({ appId: 'BadId', outDir: tmp })),
    ).toThrow();
  });

  it('rejects malformed workflow id', () => {
    expect(() =>
      promoteWorkflowToApp(
        makeReq({
          outDir: tmp,
          workflow: { id: 'Bad-ID', inputs: [], outputs: [] },
        }),
      ),
    ).toThrow();
  });

  it('preserves engine-specific body fields (passthrough)', () => {
    const out = path.join(tmp, 'app');
    promoteWorkflowToApp(
      makeReq({
        outDir: out,
        workflow: {
          id: 'main',
          body: {
            version: 'v3',
            nodes: [{ id: 'n1', type: 'agent' }],
            edges: [{ from: 'n1', to: 'sink', kind: 'next' }],
            maxDurationMs: 60000,
          },
        },
      }),
    );
    const wf = JSON.parse(
      fs.readFileSync(path.join(out, 'workflows', 'main.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(wf.version).toBe('v3');
    expect(Array.isArray(wf.nodes)).toBe(true);
    expect(Array.isArray(wf.edges)).toBe(true);
    expect(wf.maxDurationMs).toBe(60000);
  });
});
