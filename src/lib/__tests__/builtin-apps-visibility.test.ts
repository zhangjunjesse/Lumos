// Mock the settings KV before importing the module under test so each test
// gets a deterministic, isolated key/value store without touching SQLite.
const settingsStore = new Map<string, string>();

jest.mock('@/lib/db', () => ({
  getSetting: (key: string) => settingsStore.get(key),
  setSetting: (key: string, value: string) => {
    settingsStore.set(key, value);
  },
}));

import {
  BUILTIN_APP_REGISTRY,
  getBuiltinAppVisibility,
  getEffectiveHiddenAppIds,
  getHiddenBuiltinAppIds,
  getServerHiddenAppIds,
  isBuiltinAppVisible,
  listBuiltinAppDescriptors,
  setHiddenBuiltinAppIds,
  setServerHiddenAppIds,
} from '../builtin-apps-visibility';

beforeEach(() => {
  settingsStore.clear();
});

describe('builtin-apps-visibility', () => {
  it('registry exposes the three expected ids', () => {
    const ids = BUILTIN_APP_REGISTRY.map((app) => app.id).sort();
    expect(ids).toEqual(['ecommerce-assistant', 'goofish-assistant', 'wechat-assistant']);
  });

  it('listBuiltinAppDescriptors returns shallow copies (no mutation leaks)', () => {
    const list = listBuiltinAppDescriptors();
    list[0].name = 'mutated';
    const fresh = listBuiltinAppDescriptors();
    expect(fresh[0].name).not.toBe('mutated');
  });

  it('getHiddenBuiltinAppIds returns empty when nothing stored', () => {
    expect(getHiddenBuiltinAppIds()).toEqual([]);
  });

  it('getHiddenBuiltinAppIds tolerates malformed JSON / unknown ids', () => {
    settingsStore.set('builtin_apps_hidden', 'not-json');
    expect(getHiddenBuiltinAppIds()).toEqual([]);

    settingsStore.set('builtin_apps_hidden', JSON.stringify(['unknown-app', 42, null]));
    expect(getHiddenBuiltinAppIds()).toEqual([]);

    settingsStore.set(
      'builtin_apps_hidden',
      JSON.stringify(['wechat-assistant', 'unknown-app', 123]),
    );
    expect(getHiddenBuiltinAppIds()).toEqual(['wechat-assistant']);
  });

  it('setHiddenBuiltinAppIds dedupes, sorts, drops unknown ids', () => {
    const accepted = setHiddenBuiltinAppIds([
      'wechat-assistant',
      'wechat-assistant',
      'evil-app',
      'goofish-assistant',
    ]);
    expect(accepted).toEqual(['goofish-assistant', 'wechat-assistant']);
    expect(JSON.parse(settingsStore.get('builtin_apps_hidden') ?? '[]')).toEqual([
      'goofish-assistant',
      'wechat-assistant',
    ]);
  });

  it('isBuiltinAppVisible reflects the hidden set', () => {
    expect(isBuiltinAppVisible('wechat-assistant')).toBe(true);
    setHiddenBuiltinAppIds(['wechat-assistant']);
    expect(isBuiltinAppVisible('wechat-assistant')).toBe(false);
    expect(isBuiltinAppVisible('goofish-assistant')).toBe(true);
    expect(isBuiltinAppVisible('ecommerce-assistant')).toBe(true);
  });

  it('isBuiltinAppVisible returns false for unknown ids', () => {
    expect(isBuiltinAppVisible('does-not-exist')).toBe(false);
  });

  it('getBuiltinAppVisibility returns descriptors with current visibility', () => {
    setHiddenBuiltinAppIds(['goofish-assistant']);
    const visibility = getBuiltinAppVisibility();
    expect(visibility).toHaveLength(3);
    const goofish = visibility.find((v) => v.id === 'goofish-assistant')!;
    const wechat = visibility.find((v) => v.id === 'wechat-assistant')!;
    expect(goofish.visible).toBe(false);
    expect(wechat.visible).toBe(true);
    expect(goofish).toHaveProperty('name');
    expect(goofish).toHaveProperty('description');
    expect(goofish).toHaveProperty('defaultVisible');
  });

  it('clearing hidden ids restores all to visible', () => {
    setHiddenBuiltinAppIds(['wechat-assistant', 'ecommerce-assistant']);
    expect(getBuiltinAppVisibility().filter((v) => v.visible)).toHaveLength(1);
    setHiddenBuiltinAppIds([]);
    expect(getBuiltinAppVisibility().every((v) => v.visible)).toBe(true);
  });

  describe('server-override merge', () => {
    it('server hide alone marks an app hidden', () => {
      setServerHiddenAppIds(['wechat-assistant']);
      expect(isBuiltinAppVisible('wechat-assistant')).toBe(false);
      expect(getEffectiveHiddenAppIds()).toEqual(['wechat-assistant']);
    });

    it('local + server hides union', () => {
      setHiddenBuiltinAppIds(['ecommerce-assistant']);
      setServerHiddenAppIds(['wechat-assistant']);
      expect(getEffectiveHiddenAppIds()).toEqual([
        'ecommerce-assistant',
        'wechat-assistant',
      ]);
      expect(isBuiltinAppVisible('goofish-assistant')).toBe(true);
    });

    it('clearing local does not unhide server-hidden app', () => {
      setHiddenBuiltinAppIds(['wechat-assistant']);
      setServerHiddenAppIds(['wechat-assistant']);
      setHiddenBuiltinAppIds([]); // user removed local opt-out
      expect(isBuiltinAppVisible('wechat-assistant')).toBe(false);
      expect(getServerHiddenAppIds()).toEqual(['wechat-assistant']);
    });

    it('getBuiltinAppVisibility returns hiddenByUser/hiddenByServer flags', () => {
      setHiddenBuiltinAppIds(['ecommerce-assistant']);
      setServerHiddenAppIds(['wechat-assistant']);
      const v = getBuiltinAppVisibility();
      const wechat = v.find((e) => e.id === 'wechat-assistant')!;
      const ecom = v.find((e) => e.id === 'ecommerce-assistant')!;
      const goofish = v.find((e) => e.id === 'goofish-assistant')!;
      expect(wechat.hiddenByServer).toBe(true);
      expect(wechat.hiddenByUser).toBe(false);
      expect(wechat.visible).toBe(false);
      expect(ecom.hiddenByUser).toBe(true);
      expect(ecom.hiddenByServer).toBe(false);
      expect(ecom.visible).toBe(false);
      expect(goofish.visible).toBe(true);
    });

    it('setServerHiddenAppIds dedupes / drops unknown / persists', () => {
      const accepted = setServerHiddenAppIds([
        'goofish-assistant',
        'goofish-assistant',
        'evil-app',
      ]);
      expect(accepted).toEqual(['goofish-assistant']);
      expect(JSON.parse(settingsStore.get('builtin_apps_hidden_server') ?? '[]')).toEqual([
        'goofish-assistant',
      ]);
    });

    it('getServerHiddenAppIds tolerates malformed JSON', () => {
      settingsStore.set('builtin_apps_hidden_server', '{not json}');
      expect(getServerHiddenAppIds()).toEqual([]);
    });
  });
});
