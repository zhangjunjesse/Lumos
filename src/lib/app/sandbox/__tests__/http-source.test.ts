import { HttpBuilderSourceProvider } from '../http-source';

describe('HttpBuilderSourceProvider', () => {
  test('returns null for non-builder appIds', async () => {
    const provider = new HttpBuilderSourceProvider({
      getServerOrigin: () => 'http://127.0.0.1:1234',
      fetcher: async () => ({ status: 200, body: '{"artifacts":[]}' }),
    });
    expect(await provider.loadSources('installed-app')).toBeNull();
  });

  test('throws if server not ready', async () => {
    const provider = new HttpBuilderSourceProvider({
      getServerOrigin: () => null,
    });
    await expect(provider.loadSources('builder-x'))
      .rejects
      .toThrow(/local server not ready/);
  });

  test('returns null on 404', async () => {
    const provider = new HttpBuilderSourceProvider({
      getServerOrigin: () => 'http://127.0.0.1:1234',
      fetcher: async () => ({ status: 404, body: '{"error":"Session not found"}' }),
    });
    expect(await provider.loadSources('builder-x')).toBeNull();
  });

  test('parses artifacts response', async () => {
    let calledUrl = '';
    const provider = new HttpBuilderSourceProvider({
      getServerOrigin: () => 'http://127.0.0.1:1234',
      fetcher: async (url) => {
        calledUrl = url;
        return {
          status: 200,
          body: JSON.stringify({
            artifacts: [
              { filePath: 'manifest.json', content: '{"id":"x"}' },
              { filePath: 'pages/index.tsx', content: 'export default () => null;' },
            ],
          }),
        };
      },
    });
    const files = await provider.loadSources('builder-abc-123');
    expect(calledUrl).toContain('/api/apps/builder/sessions/abc-123/artifacts');
    expect(files).toHaveLength(2);
    expect(files![0].path).toBe('manifest.json');
  });

  test('loads current builder session ids that contain an underscore', async () => {
    let calledUrl = '';
    const provider = new HttpBuilderSourceProvider({
      getServerOrigin: () => 'http://127.0.0.1:1234',
      fetcher: async (url) => {
        calledUrl = url;
        return {
          status: 200,
          body: JSON.stringify({
            artifacts: [{ filePath: 'manifest.json', content: '{"id":"x"}' }],
          }),
        };
      },
    });

    const files = await provider.loadSources('builder-bs-u-1234abcd5678ef90');

    expect(calledUrl).toContain('/api/apps/builder/sessions/bs_1234abcd5678ef90/artifacts');
    expect(files).toHaveLength(1);
  });

  test('loads old slugified builder session ids from existing preview URLs', async () => {
    let calledUrl = '';
    const provider = new HttpBuilderSourceProvider({
      getServerOrigin: () => 'http://127.0.0.1:1234',
      fetcher: async (url) => {
        calledUrl = url;
        return {
          status: 200,
          body: JSON.stringify({
            artifacts: [{ filePath: 'manifest.json', content: '{"id":"x"}' }],
          }),
        };
      },
    });

    const files = await provider.loadSources('builder-bs-1234abcd5678ef90');

    expect(calledUrl).toContain('/api/apps/builder/sessions/bs_1234abcd5678ef90/artifacts');
    expect(files).toHaveLength(1);
  });

  test('throws on non-200/404 response', async () => {
    const provider = new HttpBuilderSourceProvider({
      getServerOrigin: () => 'http://127.0.0.1:1234',
      fetcher: async () => ({ status: 500, body: 'oops' }),
    });
    await expect(provider.loadSources('builder-x'))
      .rejects
      .toThrow(/status 500/);
  });

  test('throws on invalid JSON', async () => {
    const provider = new HttpBuilderSourceProvider({
      getServerOrigin: () => 'http://127.0.0.1:1234',
      fetcher: async () => ({ status: 200, body: '{not json' }),
    });
    await expect(provider.loadSources('builder-x'))
      .rejects
      .toThrow(/invalid JSON/);
  });

  test('returns null when artifacts list is empty', async () => {
    const provider = new HttpBuilderSourceProvider({
      getServerOrigin: () => 'http://127.0.0.1:1234',
      fetcher: async () => ({ status: 200, body: '{"artifacts":[]}' }),
    });
    expect(await provider.loadSources('builder-x')).toBeNull();
  });
});
