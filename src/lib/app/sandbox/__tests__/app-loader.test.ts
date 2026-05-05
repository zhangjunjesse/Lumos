import { AppLoader, BuilderSessionSourceProvider, builderAppId, parseBuilderAppId } from '../app-loader';

const VALID_MANIFEST = JSON.stringify({
  id: 'test',
  name: '测试',
  version: '0.1.0',
  entry: 'home',
  routes: [{ id: 'home', path: '/', page: 'pages/index.tsx' }],
  permissions: { db: { read: ['todos'] } },
  runtime: { engine: 'react-v2', react: '19' },
});

const SIMPLE_PAGE = `
import { Button } from '@lumos/ui';
export default function Page() { return <Button>Hi</Button>; }
`;

describe('AppLoader', () => {
  test('loads + compiles a builder session', async () => {
    const loader = new AppLoader({
      source: {
        async loadSources(appId) {
          if (appId !== 'builder-abc-123') return null;
          return [
            { path: 'manifest.json', content: VALID_MANIFEST },
            { path: 'pages/index.tsx', content: SIMPLE_PAGE },
          ];
        },
      },
    });

    const app = await loader.load('builder-abc-123');
    expect(app).not.toBeNull();
    expect(app!.manifest.id).toBe('test');
    // manifest.json is not compilable; only pages/index.tsx becomes a module
    expect(app!.modules).toHaveLength(1);
    const pageModule = app!.modules.find((m) => m.path === 'pages/index.tsx');
    expect(pageModule).toBeDefined();
    expect(pageModule!.code).toContain('jsx-runtime');
  });

  test('returns null for unknown appId', async () => {
    const loader = new AppLoader({ source: { async loadSources() { return null; } } });
    expect(await loader.load('builder-nope')).toBeNull();
  });

  test('throws when manifest.json missing', async () => {
    const loader = new AppLoader({
      source: { async loadSources() { return [{ path: 'pages/index.tsx', content: SIMPLE_PAGE }]; } },
    });
    await expect(loader.load('any')).rejects.toThrow(/manifest\.json/);
  });

  test('throws when manifest is not valid JSON', async () => {
    const loader = new AppLoader({
      source: { async loadSources() { return [{ path: 'manifest.json', content: '{{not json' }, { path: 'pages/index.tsx', content: SIMPLE_PAGE }]; } },
    });
    await expect(loader.load('any')).rejects.toThrow(/not valid JSON/);
  });

  test('reuses compile cache when sources unchanged', async () => {
    let callCount = 0;
    const loader = new AppLoader({
      source: {
        async loadSources() {
          callCount++;
          return [
            { path: 'manifest.json', content: VALID_MANIFEST },
            { path: 'pages/index.tsx', content: SIMPLE_PAGE },
          ];
        },
      },
    });
    const a = await loader.load('app-1');
    const b = await loader.load('app-1');
    expect(callCount).toBe(2); // we always read source
    // Compile cache used → modules array is same reference for unchanged files
    expect(a!.modules[0].hash).toBe(b!.modules[0].hash);
  });

  test('invalidate() forces re-compile', async () => {
    let version = 1;
    const loader = new AppLoader({
      source: {
        async loadSources() {
          return [
            { path: 'manifest.json', content: VALID_MANIFEST },
            { path: 'pages/index.tsx', content: `// v${version++}\n${SIMPLE_PAGE}` },
          ];
        },
      },
    });
    const a = await loader.load('app-1');
    loader.invalidate('app-1');
    const b = await loader.load('app-1');
    expect(a!.modules[0].hash).not.toBe(b!.modules[0].hash);
  });

  test('throws on compile error with file:line', async () => {
    const loader = new AppLoader({
      source: { async loadSources() { return [
        { path: 'manifest.json', content: VALID_MANIFEST },
        { path: 'pages/index.tsx', content: 'import axios from "axios"; export default function P() { return null }' },
      ]; } },
    });
    await expect(loader.load('a')).rejects.toThrow(/axios/);
  });
});

describe('BuilderSessionSourceProvider', () => {
  test('looks up artifacts by parsed sessionId', async () => {
    const seen: string[] = [];
    const provider = new BuilderSessionSourceProvider({
      listArtifacts: (sessionId) => {
        seen.push(sessionId);
        return [{ filePath: 'manifest.json', content: '{}' }];
      },
    });
    const files = await provider.loadSources('builder-my-session-id');
    expect(seen).toEqual(['my-session-id']);
    expect(files).toHaveLength(1);
  });

  test('returns null for non-builder appIds', async () => {
    const provider = new BuilderSessionSourceProvider({ listArtifacts: () => [] });
    expect(await provider.loadSources('installed-app')).toBeNull();
  });
});

describe('builderAppId / parseBuilderAppId', () => {
  test('round-trips slug-safe ids', () => {
    const id = builderAppId('abc12345');
    expect(id).toBe('builder-abc12345');
    expect(parseBuilderAppId(id)).toBe('abc12345');
  });

  test('round-trips builder session ids with underscores', () => {
    const id = builderAppId('bs_1234abcd5678ef90');
    expect(id).toBe('builder-bs-u-1234abcd5678ef90');
    expect(parseBuilderAppId(id)).toBe('bs_1234abcd5678ef90');
  });

  test('keeps compatibility with old slugified builder session ids', () => {
    expect(parseBuilderAppId('builder-bs-1234abcd5678ef90')).toBe('bs_1234abcd5678ef90');
  });

  test('slugifies UUIDs', () => {
    const id = builderAppId('A1B2C3-D4-E5');
    expect(id).toMatch(/^builder-[a-z0-9-]+$/);
  });
});
