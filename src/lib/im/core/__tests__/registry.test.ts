import {
  registerPlugin,
  getPlugin,
  listPlugins,
  listProviderIds,
  hasProvider,
  __resetRegistryForTesting,
} from '../registry';
import type { IMPlugin, IMAdapter } from '../types';

function makePlugin(id: string): IMPlugin {
  return {
    manifest: {
      id,
      label: id.toUpperCase(),
      description: '',
      configSchema: [],
      capabilities: {
        chatTypes: ['direct'],
        media: false,
        reactions: false,
        threads: false,
        edit: false,
        commands: false,
        targetDirectory: false,
        streamingPreview: false,
      },
    },
    createAdapter: () => ({} as IMAdapter),
  };
}

describe('im/core/registry', () => {
  beforeEach(() => __resetRegistryForTesting());

  test('registers and retrieves plugins', () => {
    const p = makePlugin('foo');
    registerPlugin(p);
    expect(getPlugin('foo')).toBe(p);
    expect(hasProvider('foo')).toBe(true);
    expect(hasProvider('bar')).toBe(false);
  });

  test('listPlugins returns all registered', () => {
    registerPlugin(makePlugin('a'));
    registerPlugin(makePlugin('b'));
    expect(listProviderIds().sort()).toEqual(['a', 'b']);
    expect(listPlugins()).toHaveLength(2);
  });

  test('rejects duplicate ids', () => {
    registerPlugin(makePlugin('dup'));
    expect(() => registerPlugin(makePlugin('dup'))).toThrow(/duplicate/);
  });

  test('returns null for unknown id', () => {
    expect(getPlugin('nope')).toBeNull();
  });
});
