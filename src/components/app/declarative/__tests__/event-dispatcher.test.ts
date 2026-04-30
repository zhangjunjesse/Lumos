import {
  EventParseError,
  dispatchEvent,
  parseEventDsl,
} from '../event-dispatcher';

describe('parseEventDsl', () => {
  it('parses workflow', () => {
    expect(parseEventDsl('workflow:generate-report')).toEqual({
      kind: 'workflow',
      workflowId: 'generate-report',
    });
  });

  it('parses db ops', () => {
    expect(parseEventDsl('db:create:customers')).toEqual({
      kind: 'db',
      op: 'create',
      collection: 'customers',
    });
    expect(parseEventDsl('db:update:customers')).toEqual({
      kind: 'db',
      op: 'update',
      collection: 'customers',
    });
    expect(parseEventDsl('db:delete:customers')).toEqual({
      kind: 'db',
      op: 'delete',
      collection: 'customers',
    });
  });

  it('parses page and dialog', () => {
    expect(parseEventDsl('page:home')).toEqual({ kind: 'page', menuId: 'home' });
    expect(parseEventDsl('dialog:create-customer')).toEqual({
      kind: 'dialog',
      dialogId: 'create-customer',
    });
  });

  it.each([
    [''],
    ['unknown:foo'],
    ['workflow:'],
    ['workflow:Bad-Id'],
    ['workflow:foo:bar'],
    ['db:create'],
    ['db:wipe:customers'],
    ['db:create:Bad-Collection'],
    ['page:'],
    ['dialog:'],
  ])('rejects invalid: %s', (dsl) => {
    expect(() => parseEventDsl(dsl)).toThrow(EventParseError);
  });
});

describe('dispatchEvent', () => {
  function makeHandlers() {
    return {
      onWorkflow: jest.fn().mockResolvedValue('wf-result'),
      onDbCreate: jest.fn().mockResolvedValue({ id: 'new-row' }),
      onDbUpdate: jest.fn().mockResolvedValue(undefined),
      onDbDelete: jest.fn().mockResolvedValue(true),
      onPage: jest.fn(),
      onDialog: jest.fn(),
    };
  }

  it('routes workflow events with inputs', async () => {
    const h = makeHandlers();
    const result = await dispatchEvent(
      parseEventDsl('workflow:generate'),
      { inputs: { x: 1 } },
      h,
    );
    expect(h.onWorkflow).toHaveBeenCalledWith('generate', { x: 1 });
    expect(result).toBe('wf-result');
  });

  it('routes db:create with the data payload', async () => {
    const h = makeHandlers();
    await dispatchEvent(
      parseEventDsl('db:create:customers'),
      { data: { name: 'Alice' } },
      h,
    );
    expect(h.onDbCreate).toHaveBeenCalledWith('customers', { name: 'Alice' });
  });

  it('falls back to inputs as data for db:create', async () => {
    const h = makeHandlers();
    await dispatchEvent(
      parseEventDsl('db:create:customers'),
      { inputs: { name: 'Bob' } },
      h,
    );
    expect(h.onDbCreate).toHaveBeenCalledWith('customers', { name: 'Bob' });
  });

  it('requires rowId for db:update', async () => {
    const h = makeHandlers();
    await expect(
      dispatchEvent(parseEventDsl('db:update:customers'), {}, h),
    ).rejects.toBeInstanceOf(EventParseError);
  });

  it('routes db:update with rowId + patch', async () => {
    const h = makeHandlers();
    await dispatchEvent(
      parseEventDsl('db:update:customers'),
      { rowId: 'r1', patch: { phone: '111' } },
      h,
    );
    expect(h.onDbUpdate).toHaveBeenCalledWith('customers', 'r1', { phone: '111' });
  });

  it('routes db:delete with rowId', async () => {
    const h = makeHandlers();
    await dispatchEvent(
      parseEventDsl('db:delete:customers'),
      { rowId: 'r1' },
      h,
    );
    expect(h.onDbDelete).toHaveBeenCalledWith('customers', 'r1');
  });

  it('routes page navigation', async () => {
    const h = makeHandlers();
    await dispatchEvent(parseEventDsl('page:settings'), {}, h);
    expect(h.onPage).toHaveBeenCalledWith('settings');
  });

  it('routes dialog open', async () => {
    const h = makeHandlers();
    await dispatchEvent(parseEventDsl('dialog:create'), {}, h);
    expect(h.onDialog).toHaveBeenCalledWith('create');
  });
});
