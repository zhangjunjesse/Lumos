import type * as React from 'react';

import { mergeAutomations } from '../use-wechat-automations';
import type { Automation } from '../relations-types';

function auto(id: string, name = id): Automation {
  return {
    id,
    name,
    kind: 'reminder_recurring',
    cron: '0 9 * * *',
    cronLabel: '每天 09:00',
    action: { kind: 'custom', messageTemplate: 'x' },
    enabled: true,
    createdAt: 1,
  };
}

const ref = <T,>(value: T): React.MutableRefObject<T> => ({ current: value });

describe('mergeAutomations 乐观新建防 stale refresh 抹除', () => {
  it('keeps an optimistically-created automation the stale server list has not caught up to', () => {
    const created = auto('new-1');
    const merged = mergeAutomations(
      [created, auto('srv-1')],
      [auto('srv-1')], // 服务端列表还没收录 new-1（stale）
      ref(new Map()),
      ref(null),
      ref(new Set(['new-1'])),
    );
    expect(merged.map((a) => a.id).sort()).toEqual(['new-1', 'srv-1']);
  });

  it('drops a prev-only automation that is neither dirty nor newly created (deleted elsewhere)', () => {
    const merged = mergeAutomations(
      [auto('gone'), auto('srv-1')],
      [auto('srv-1')],
      ref(new Map()),
      ref(null),
      ref(new Set()),
    );
    expect(merged.map((a) => a.id)).toEqual(['srv-1']);
  });

  it('clears create-protection once the server list confirms the id (no ghost afterwards)', () => {
    const createdRef = ref(new Set(['new-1']));
    // 第一次刷新：服务端已收录 new-1 → 用服务端版本且撤销保护
    const first = mergeAutomations([auto('new-1')], [auto('new-1', 'srv-name')], ref(new Map()), ref(null), createdRef);
    expect(first.map((a) => a.name)).toEqual(['srv-name']);
    expect(createdRef.current.has('new-1')).toBe(false);
    // 之后服务端真的删了它 → 不再被保护，正确消失
    const second = mergeAutomations([auto('new-1')], [], ref(new Map()), ref(null), createdRef);
    expect(second).toEqual([]);
  });

  it('still protects dirty (unsaved-edit) prev-only entries', () => {
    const merged = mergeAutomations(
      [auto('editing')],
      [],
      ref(new Map([['editing', { name: 'x' }]])),
      ref(null),
      ref(new Set()),
    );
    expect(merged.map((a) => a.id)).toEqual(['editing']);
  });
});
