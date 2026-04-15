import type { AdapterContext } from '../adapter-types';
import { projectGutenbergAdapter } from '../adapters/gutenberg';

function createContextWithMap(map: Record<string, { status?: number; html: string; contentType?: string }>): AdapterContext {
  return {
    fetch: jest.fn(async (url: string) => {
      const hit = map[url];
      if (!hit) {
        throw new Error(`unexpected url: ${url}`);
      }
      return {
        status: hit.status ?? 200,
        html: hit.html,
        contentType: hit.contentType ?? 'text/plain',
      };
    }),
    browserCapture: jest.fn(),
    siteEvaluate: jest.fn(),
  };
}

describe('project gutenberg adapter', () => {
  test('parses OPDS search results', async () => {
    const ctx = createContextWithMap({
      'https://www.gutenberg.org/ebooks/search.opds/?query=pride%20prejudice': {
        html: `<?xml version="1.0" encoding="utf-8"?>
          <feed>
            <entry>
              <id>https://www.gutenberg.org/ebooks/1342.opds</id>
              <title>Pride and Prejudice</title>
              <content type="text">Jane Austen</content>
              <link rel="subsection" href="/ebooks/1342.opds"/>
            </entry>
            <entry>
              <id>https://www.gutenberg.org/ebooks/64317.opds</id>
              <title>Sense and Sensibility</title>
              <content type="text">Jane Austen</content>
              <link rel="subsection" href="/ebooks/64317.opds"/>
            </entry>
          </feed>`,
        contentType: 'application/atom+xml',
      },
    });

    const result = await projectGutenbergAdapter.search(ctx, 'pride prejudice', 5);
    expect(result.items).toEqual([
      {
        url: 'https://www.gutenberg.org/ebooks/1342',
        title: 'Pride and Prejudice',
        snippet: 'Author: Jane Austen',
        extra: {
          ebookId: '1342',
          author: 'Jane Austen',
          detailOpdsUrl: 'https://www.gutenberg.org/ebooks/1342.opds',
        },
      },
      {
        url: 'https://www.gutenberg.org/ebooks/64317',
        title: 'Sense and Sensibility',
        snippet: 'Author: Jane Austen',
        extra: {
          ebookId: '64317',
          author: 'Jane Austen',
          detailOpdsUrl: 'https://www.gutenberg.org/ebooks/64317.opds',
        },
      },
    ]);
  });

  test('extracts full text from official plain-text fallback pattern', async () => {
    const ctx = createContextWithMap({
      'https://www.gutenberg.org/cache/epub/1342/pg1342.txt': {
        html: `Project Gutenberg's Pride and Prejudice\n\nTitle: Pride and Prejudice\nAuthor: Jane Austen\n\nChapter 1\nIt is a truth universally acknowledged...`,
        contentType: 'text/plain; charset=utf-8',
      },
    });

    const result = await projectGutenbergAdapter.extract(ctx, 'https://www.gutenberg.org/ebooks/1342');
    expect(result.title).toBe('Pride and Prejudice');
    expect(result.contentText).toContain('Title: Pride and Prejudice');
    expect(result.contentState).toBe('partial');
    expect(result.structuredData).toMatchObject({
      adapter: 'project_gutenberg',
      pageType: 'plain_text_detail',
      ebookId: '1342',
      author: 'Jane Austen',
      downloadUrl: 'https://www.gutenberg.org/cache/epub/1342/pg1342.txt',
    });
  });

  test('treats gutenberg as login-free', async () => {
    const probe = await projectGutenbergAdapter.probeLogin(createContextWithMap({}), {
      baseUrl: 'https://www.gutenberg.org/',
    });
    expect(probe).toEqual({
      siteKey: 'project_gutenberg',
      loginState: 'connected',
      blockingReason: '',
      lastError: '',
    });
  });
});
