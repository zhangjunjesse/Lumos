import {
  buildFailedJobAskAiPrompt,
  buildOnboardingAskAiPrompt,
  dispatchAskAi,
} from '../ecommerce-ask-ai';

describe('buildOnboardingAskAiPrompt', () => {
  it('asks the AI to check status first and covers field / quota / aspect-ratio questions', () => {
    const text = buildOnboardingAskAiPrompt();
    expect(text).toContain('get_ecommerce_status');
    expect(text).toMatch(/工坊|新建商品/);
    expect(text).toMatch(/配额|消耗/);
    expect(text).toMatch(/1:1|3:4/);
  });

  it('is deterministic so a snapshot UX always gets the same wording', () => {
    expect(buildOnboardingAskAiPrompt()).toBe(buildOnboardingAskAiPrompt());
  });
});

describe('buildFailedJobAskAiPrompt', () => {
  it('emits a single Chinese question that the AI can answer with concrete context', () => {
    const text = buildFailedJobAskAiPrompt({
      jobId: 'job-1',
      jobStatus: 'failed',
      jobStage: 'cutting',
      inputTitle: '手作陶瓷杯',
      failureReason: '主图分辨率过低',
      failureStage: 'preprocess',
    });
    expect(text).toContain('「手作陶瓷杯」');
    expect(text).toContain('为什么失败');
    expect(text).toContain('job-1');
    expect(text).toContain('failed');
    expect(text).toContain('cutting');
    expect(text).toContain('preprocess');
    expect(text).toContain('主图分辨率过低');
    expect(text).toContain('list_image_jobs');
  });

  it('uses "被取消" wording for cancelled jobs', () => {
    const text = buildFailedJobAskAiPrompt({
      jobId: 'job-2',
      jobStatus: 'cancelled',
    });
    expect(text).toContain('被取消');
    expect(text).not.toContain('为什么失败');
  });

  it('drops optional fields without leaving dangling labels', () => {
    const text = buildFailedJobAskAiPrompt({
      jobId: 'job-3',
      jobStatus: 'failed',
    });
    expect(text).not.toContain('最后阶段:');
    expect(text).not.toContain('失败阶段:');
    expect(text).not.toContain('失败原因:');
    expect(text).not.toContain('「');
  });

  it('omits the input title block when no title is provided', () => {
    const text = buildFailedJobAskAiPrompt({
      jobId: 'job-4',
      jobStatus: 'failed',
      inputTitle: null,
    });
    expect(text).not.toContain('「');
  });
});

describe('dispatchAskAi', () => {
  const realWindow = (globalThis as { window?: unknown }).window;
  const realCustomEvent = (globalThis as { CustomEvent?: unknown }).CustomEvent;
  const events: Array<{ type: string; detail?: unknown }> = [];

  beforeEach(() => {
    events.length = 0;
    (globalThis as { CustomEvent?: unknown }).CustomEvent = class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
    (globalThis as { window?: unknown }).window = {
      dispatchEvent(event: { type: string; detail?: unknown }) {
        events.push({ type: event.type, detail: event.detail });
        return true;
      },
    };
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = realWindow;
    (globalThis as { CustomEvent?: unknown }).CustomEvent = realCustomEvent;
  });

  it('dispatches both lumos:chat-expand and lumos:chat-draft with the given text', () => {
    dispatchAskAi('请帮我排查这个任务');

    expect(events.map((e) => e.type)).toEqual([
      'lumos:chat-expand',
      'lumos:chat-draft',
    ]);
    expect(events[1].detail).toEqual({
      text: '请帮我排查这个任务',
      mode: 'replace',
    });
  });

  it('is a no-op when window is undefined (SSR safety)', () => {
    (globalThis as { window?: unknown }).window = undefined;
    expect(() => dispatchAskAi('whatever')).not.toThrow();
    expect(events).toEqual([]);
  });
});
