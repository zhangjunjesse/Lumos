import { compileApp, createModuleCache } from '../compiler';

describe('react-v2 compiler', () => {
  test('compiles a minimal page', async () => {
    const result = await compileApp(
      [{
        path: 'pages/index.tsx',
        content: `
import { Button } from '@lumos/ui';
import { db } from '@lumos/app';

export default function HomePage() {
  return <Button onClick={() => db.collection('todos').list()}>Hi</Button>;
}
`,
      }],
      { appId: 'test-app' },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
    expect(result.modules).toHaveLength(1);
    const mod = result.modules[0];
    expect(mod.path).toBe('pages/index.tsx');
    expect(mod.outputPath).toBe('_app/pages/index.tsx.mjs');
    expect(mod.code).toContain('react/jsx-runtime');
    expect(mod.imports).toContain('@lumos/ui');
    expect(mod.imports).toContain('@lumos/app');
  });

  test('rejects disallowed file paths', async () => {
    const result = await compileApp(
      [{
        path: 'pages/Bad-Name.tsx',
        content: 'export default () => null;',
      }],
      { appId: 'test-app' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].message).toMatch(/路径不在允许范围/);
    }
  });

  test('rejects imports outside whitelist', async () => {
    const result = await compileApp(
      [{
        path: 'pages/x.tsx',
        content: `
import axios from 'axios';
import lodash from 'lodash';
export default () => null;
`,
      }],
      { appId: 'a' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const msg = result.errors.map((e) => e.message).join('\n');
      expect(msg).toMatch(/axios/);
      expect(msg).toMatch(/lodash/);
    }
  });

  test('rejects deps that are not currently bundled in the iframe runtime', async () => {
    const result = await compileApp(
      [{
        path: 'pages/form.tsx',
        content: `
import { useForm } from 'react-hook-form';
export default function P() { useForm(); return null; }
`,
      }],
      { appId: 'a' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const msg = result.errors.map((e) => e.message).join('\n');
      expect(msg).toMatch(/react-hook-form/);
      expect(msg).toMatch(/应用运行时白名单/);
    }
  });

  test('allows the default Lumos app UI stack', async () => {
    const result = await compileApp(
      [{
        path: 'pages/ui.tsx',
        content: `
import { Button, Card, cn } from '@lumos/ui';
import { notify } from '@lumos/app';
import { Search } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export default function P() {
  return (
    <Card className={twMerge(clsx(cn('p-4')))}>
      <Button onClick={() => notify.toast({ title: 'ok' })}>
        <Search />
        Search
      </Button>
    </Card>
  );
}
`,
      }],
      { appId: 'a' },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
    expect(result.modules[0].imports).toEqual(expect.arrayContaining([
      '@lumos/ui',
      '@lumos/app',
      'lucide-react',
      'clsx',
      'tailwind-merge',
    ]));
  });

  test('reports syntax errors with line numbers', async () => {
    const result = await compileApp(
      [{
        path: 'pages/x.tsx',
        content: `export default function Bad() { return <div </div>; }`,
      }],
      { appId: 'a' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].file).toBe('pages/x.tsx');
      expect(result.errors[0].line).toBeGreaterThanOrEqual(1);
    }
  });

  test('cache returns same module without recompiling', async () => {
    const cache = createModuleCache();
    const file = {
      path: 'pages/cached.tsx',
      content: 'export default function P() { return null; }',
    };
    const a = await compileApp([file], { appId: 'a', cache });
    const b = await compileApp([file], { appId: 'a', cache });
    if (!a.ok || !b.ok) throw new Error('compile failed');
    expect(b.fromCache).toEqual(['pages/cached.tsx']);
    expect(a.modules[0].hash).toBe(b.modules[0].hash);
  });

  test('allows relative imports between pages and components', async () => {
    const result = await compileApp(
      [
        {
          path: 'pages/index.tsx',
          content: `
import { Card } from '../components/card';
import { format } from '../lib/format';
export default function P() { return <Card label={format('x')} />; }
`,
        },
        {
          path: 'components/card.tsx',
          content: 'export const Card = (p: { label: string }) => null;',
        },
        {
          path: 'lib/format.ts',
          content: 'export const format = (s: string) => s.toUpperCase();',
        },
      ],
      { appId: 'a' },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
    expect(result.modules).toHaveLength(3);
  });

  test('allows bundled workflow json files as non-compilable app artifacts', async () => {
    const result = await compileApp(
      [
        {
          path: 'workflows/weekly-report.json',
          content: JSON.stringify({ id: 'weekly-report', name: '周报', inputs: [], outputs: [] }),
        },
        {
          path: 'pages/index.tsx',
          content: 'export default function P() { return null; }',
        },
      ],
      { appId: 'a' },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
    expect(result.modules.map((module) => module.path)).toEqual(['pages/index.tsx']);
  });
});
