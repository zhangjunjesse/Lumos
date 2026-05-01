import { pickImHeaderSlot } from '../header-dispatch';

describe('pickImHeaderSlot', () => {
  test('null / undefined → none', () => {
    expect(pickImHeaderSlot(null)).toBe('none');
    expect(pickImHeaderSlot(undefined)).toBe('none');
  });

  test('empty string → none', () => {
    expect(pickImHeaderSlot('')).toBe('none');
  });

  test('wechat → wechat', () => {
    expect(pickImHeaderSlot('wechat')).toBe('wechat');
  });

  test('feishu → feishu', () => {
    expect(pickImHeaderSlot('feishu')).toBe('feishu');
  });

  test('unknown / future provider id → none (no header until UI ships)', () => {
    expect(pickImHeaderSlot('telegram')).toBe('none');
    expect(pickImHeaderSlot('line')).toBe('none');
  });
});
