import fs from 'fs';
import os from 'os';
import path from 'path';

describe('browserStep', () => {
  let previousDataDir: string | undefined;
  let originalFetch: typeof global.fetch | undefined;
  let tempDir: string;

  beforeEach(() => {
    jest.resetModules();
    previousDataDir = process.env.LUMOS_DATA_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-browser-step-test-'));
    process.env.LUMOS_DATA_DIR = tempDir;
    originalFetch = global.fetch;
  });

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as any).fetch;
    }

    if (previousDataDir === undefined) {
      delete process.env.LUMOS_DATA_DIR;
    } else {
      process.env.LUMOS_DATA_DIR = previousDataDir;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('uses browser bridge runtime file for navigate and snapshot', async () => {
    const runtimeDir = path.join(tempDir, 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeDir, 'browser-bridge.json'),
      JSON.stringify({
        url: 'http://127.0.0.1:43210',
        token: 'bridge-token',
      }),
      'utf-8',
    );

    const fetchMock = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, pageId: 'page-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        pageId: 'page-1',
        url: 'https://example.com/',
        title: 'Example Domain',
        lines: ['Example Domain'],
      }), { status: 200 }));
    global.fetch = fetchMock as typeof global.fetch;

    const { browserStep } = await import('../steps/browserStep');
    const result = await browserStep({
      action: 'navigate',
      url: 'https://example.com',
      __runtime: {
        workflowRunId: 'wf-browser-001',
        stepId: 'browse',
        stepType: 'browser',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:43210/v1/pages/navigate');
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:43210/v1/pages/snapshot');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'x-lumos-bridge-token': 'bridge-token',
      }),
    });

    expect(result).toMatchObject({
      success: true,
      output: {
        action: 'navigate',
        pageId: 'page-1',
        url: 'https://example.com/',
        title: 'Example Domain',
        lines: ['Example Domain'],
      },
      metadata: {
        workflowRunId: 'wf-browser-001',
        stepId: 'browse',
        executionMode: 'browser-bridge',
        bridgeSource: 'runtime-file',
      },
    });
  });

  test('creates a dedicated page when navigate requests isolated browser execution', async () => {
    const runtimeDir = path.join(tempDir, 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeDir, 'browser-bridge.json'),
      JSON.stringify({
        url: 'http://127.0.0.1:43210',
        token: 'bridge-token',
      }),
      'utf-8',
    );

    const fetchMock = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, pageId: 'page-branch-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        pageId: 'page-branch-1',
        url: 'https://example.org/',
        title: 'Example Domain',
        lines: ['Example Domain'],
      }), { status: 200 }));
    global.fetch = fetchMock as typeof global.fetch;

    const { browserStep } = await import('../steps/browserStep');
    const result = await browserStep({
      action: 'navigate',
      url: 'https://example.org',
      createPage: true,
      __runtime: {
        workflowRunId: 'wf-browser-branch-001',
        stepId: 'browse_1',
        stepType: 'browser',
      },
    });

    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:43210/v1/pages/new');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      url: 'https://example.org',
    });
    expect(result).toMatchObject({
      success: true,
      output: {
        pageId: 'page-branch-1',
        url: 'https://example.org/',
      },
    });
  });

  test('passes explicit pageId to screenshot capture', async () => {
    const runtimeDir = path.join(tempDir, 'runtime');
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeDir, 'browser-bridge.json'),
      JSON.stringify({
        url: 'http://127.0.0.1:43210',
        token: 'bridge-token',
      }),
      'utf-8',
    );

    const screenshotPath = path.join(tempDir, 'capture.png');
    fs.writeFileSync(screenshotPath, Buffer.from('fake-image'));

    const fetchMock = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        pageId: 'page-branch-1',
        filePath: screenshotPath,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        pageId: 'page-branch-1',
        url: 'https://example.org/',
        title: 'Example Domain',
        lines: ['Example Domain'],
      }), { status: 200 }));
    global.fetch = fetchMock as typeof global.fetch;

    const { browserStep } = await import('../steps/browserStep');
    const result = await browserStep({
      action: 'screenshot',
      pageId: 'page-branch-1',
      __runtime: {
        workflowRunId: 'wf-browser-branch-002',
        stepId: 'capture_1',
        stepType: 'browser',
      },
    });

    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:43210/v1/pages/screenshot');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      pageId: 'page-branch-1',
    });
    expect(result).toMatchObject({
      success: true,
      output: {
        pageId: 'page-branch-1',
        screenshotPath,
      },
    });
  });

  test('falls back to synthetic mode when browser bridge is unavailable', async () => {
    const { browserStep } = await import('../steps/browserStep');
    const result = await browserStep({
      action: 'click',
      selector: '#submit',
      __runtime: {
        workflowRunId: 'wf-browser-002',
        stepId: 'browse-fallback',
        stepType: 'browser',
      },
    });

    expect(result).toMatchObject({
      success: true,
      output: {
        action: 'click',
        selector: '#submit',
        result: 'Synthetic click completed',
      },
      metadata: {
        workflowRunId: 'wf-browser-002',
        stepId: 'browse-fallback',
        executionMode: 'synthetic',
      },
    });
  });
});
