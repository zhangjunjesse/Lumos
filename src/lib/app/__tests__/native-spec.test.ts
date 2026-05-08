import { parseNativeAppSpecForUi } from '../native-spec';

describe('parseNativeAppSpecForUi', () => {
  it('extracts user-facing acceptance checks and ignores malformed entries', () => {
    expect(parseNativeAppSpecForUi({
      summary: '订单助手规格',
      acceptance: [
        { id: 'open-app', label: '打开应用', howToVerify: '从应用列表打开。' },
        { id: 'bad', label: '缺步骤' },
        null,
      ],
    })).toEqual({
      summary: '订单助手规格',
      acceptance: [
        { id: 'open-app', label: '打开应用', howToVerify: '从应用列表打开。' },
      ],
    });
  });

  it('returns null for non-object values', () => {
    expect(parseNativeAppSpecForUi(null)).toBeNull();
    expect(parseNativeAppSpecForUi('x')).toBeNull();
  });
});
