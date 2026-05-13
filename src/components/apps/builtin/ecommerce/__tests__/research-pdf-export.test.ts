import { buildPrintableHtml, openReportPrintWindow } from '../research-pdf-export';

describe('buildPrintableHtml', () => {
  it('escapes the title to prevent HTML injection from user-supplied query', () => {
    const html = buildPrintableHtml({
      title: '<script>alert(1)</script>',
      bodyHtml: '<p>safe</p>',
    });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
  });

  it('includes a print stylesheet that targets @page and h1/h2', () => {
    const html = buildPrintableHtml({ title: 't', bodyHtml: '' });
    expect(html).toContain('@page');
    expect(html).toMatch(/h1\s*{/);
    expect(html).toMatch(/h2\s*{/);
  });

  it('renders the meta block with non-empty entries only', () => {
    const html = buildPrintableHtml({
      title: 't',
      bodyHtml: '',
      meta: { 平台: 'etsy', 字数: '', 来源: null, 备注: undefined },
    });
    expect(html).toContain('<strong>平台</strong>');
    expect(html).toContain('etsy');
    expect(html).not.toContain('字数');
    expect(html).not.toContain('来源');
  });

  it('triggers window.print() after the body renders (via inline script)', () => {
    const html = buildPrintableHtml({ title: 't', bodyHtml: '' });
    expect(html).toContain('window.print()');
    expect(html).toContain('requestAnimationFrame');
  });

  it('puts the bodyHtml inside a .report-body wrapper unchanged', () => {
    const html = buildPrintableHtml({
      title: 't',
      bodyHtml: '<h2>分析</h2><ul><li>a</li></ul>',
    });
    expect(html).toContain('<div class="report-body"><h2>分析</h2><ul><li>a</li></ul></div>');
  });
});

describe('openReportPrintWindow', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it('returns false when no window is available (SSR)', () => {
    (globalThis as { window?: unknown }).window = undefined;
    expect(openReportPrintWindow({ title: 't', bodyHtml: '' })).toBe(false);
  });

  it('returns false when the popup is blocked', () => {
    (globalThis as { window?: unknown }).window = {
      open: () => null,
    };
    expect(openReportPrintWindow({ title: 't', bodyHtml: '' })).toBe(false);
  });

  it('writes the printable HTML into the popup and closes the stream', () => {
    let writtenHtml = '';
    let opened = false;
    let closed = false;
    const fakePopup = {
      document: {
        open() {
          opened = true;
        },
        write(html: string) {
          writtenHtml = html;
        },
        close() {
          closed = true;
        },
      },
    };
    (globalThis as { window?: unknown }).window = {
      open: () => fakePopup,
    };
    const ok = openReportPrintWindow({
      title: '调研',
      bodyHtml: '<p>x</p>',
      meta: { 平台: 'etsy' },
    });
    expect(ok).toBe(true);
    expect(opened).toBe(true);
    expect(closed).toBe(true);
    expect(writtenHtml).toContain('调研');
    expect(writtenHtml).toContain('<p>x</p>');
    expect(writtenHtml).toContain('etsy');
  });
});
