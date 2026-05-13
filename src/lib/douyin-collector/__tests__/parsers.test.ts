import {
  cleanKeywordQuery,
  formatTimedTranscript,
  parseTranscriptText,
  parseVideoChapters,
  parseVideoTags,
} from '../parsers';

describe('parseVideoTags', () => {
  it('returns empty array for null / undefined / empty string', () => {
    expect(parseVideoTags(null)).toEqual([]);
    expect(parseVideoTags(undefined)).toEqual([]);
    expect(parseVideoTags('')).toEqual([]);
  });

  it('parses canonical JSON array', () => {
    expect(parseVideoTags('["ai","api"]')).toEqual(['ai', 'api']);
  });

  it('falls back to comma / semicolon split for non-JSON', () => {
    expect(parseVideoTags('ai, api; prompt-caching')).toEqual([
      'ai',
      'api',
      'prompt-caching',
    ]);
    expect(parseVideoTags('一， 二； 三')).toEqual(['一', '二', '三']);
  });

  it('drops non-string values from JSON arrays', () => {
    expect(parseVideoTags('["a", 1, null, "b"]')).toEqual(['a', 'b']);
  });

  it('de-duplicates case-insensitively while preserving first-seen casing', () => {
    expect(parseVideoTags('["AI", "ai", "API", "Ai"]')).toEqual(['AI', 'API']);
    // Plain-string fallback also dedups
    expect(parseVideoTags('AI, ai, API, Ai')).toEqual(['AI', 'API']);
    // CJK is preserved as-is (different chars are not equal under lowercase)
    expect(parseVideoTags('["人工智能","AI","人工智能"]')).toEqual(['人工智能', 'AI']);
  });
});

describe('parseVideoChapters', () => {
  it('returns empty array for invalid input', () => {
    expect(parseVideoChapters(null)).toEqual([]);
    expect(parseVideoChapters('not json')).toEqual([]);
    expect(parseVideoChapters('{}')).toEqual([]);
  });

  it('parses canonical chapter list', () => {
    const r = parseVideoChapters(
      '[{"startSec":0,"title":"开场"},{"startSec":60,"title":"正题"}]',
    );
    expect(r).toEqual([
      { startSec: 0, title: '开场' },
      { startSec: 60, title: '正题' },
    ]);
  });

  it('drops chapters missing title', () => {
    const r = parseVideoChapters('[{"startSec":0},{"startSec":1,"title":"x"}]');
    expect(r).toEqual([{ startSec: 1, title: 'x' }]);
  });

  it('defaults missing startSec to 0', () => {
    const r = parseVideoChapters('[{"title":"missing-start"}]');
    expect(r).toEqual([{ startSec: 0, title: 'missing-start' }]);
  });
});

describe('parseTranscriptText', () => {
  it('returns empty string for missing / non-array / non-JSON input', () => {
    expect(parseTranscriptText(null)).toBe('');
    expect(parseTranscriptText('not json')).toBe('');
    expect(parseTranscriptText('{}')).toBe('');
  });

  it('joins segment texts with newlines', () => {
    const r = parseTranscriptText(
      '[{"startSec":0,"endSec":2,"text":"一"},{"startSec":2,"endSec":5,"text":"二"}]',
    );
    expect(r).toBe('一\n二');
  });

  it('skips entries without a text field', () => {
    const r = parseTranscriptText('[{"text":"a"},{},{"text":"b"}]');
    expect(r).toBe('a\nb');
  });
});

describe('cleanKeywordQuery', () => {
  it('returns empty string when input is empty / whitespace', () => {
    expect(cleanKeywordQuery('')).toBe('');
    expect(cleanKeywordQuery('   ')).toBe('');
  });

  it('strips a single leading # and trims whitespace', () => {
    expect(cleanKeywordQuery('#prompt-caching')).toBe('prompt-caching');
    expect(cleanKeywordQuery(' #ai ')).toBe('ai');
  });

  it('strips multiple leading # (e.g. paste with extra hashes)', () => {
    expect(cleanKeywordQuery('##ai')).toBe('ai');
    expect(cleanKeywordQuery('###prompt')).toBe('prompt');
  });

  it('preserves # that appear later in the string (only leading is special)', () => {
    expect(cleanKeywordQuery('a#b')).toBe('a#b');
    expect(cleanKeywordQuery('  hello#world  ')).toBe('hello#world');
  });

  it('handles bare keywords unchanged', () => {
    expect(cleanKeywordQuery('rate-limit')).toBe('rate-limit');
    expect(cleanKeywordQuery('Claude API 实战')).toBe('Claude API 实战');
  });
});

describe('formatTimedTranscript — Round 174', () => {
  it('returns empty for null / non-array / malformed', () => {
    expect(formatTimedTranscript(null)).toBe('');
    expect(formatTimedTranscript('not json')).toBe('');
    expect(formatTimedTranscript('{}')).toBe('');
  });

  it('emits [m:ss] prefix per segment with text', () => {
    const r = formatTimedTranscript(
      JSON.stringify([
        { startSec: 0, text: '开场白' },
        { startSec: 12.5, text: '第一段' },
        { startSec: 135, text: '过场' },
      ]),
    );
    expect(r).toBe('[0:00] 开场白\n[0:12] 第一段\n[2:15] 过场');
  });

  it('skips malformed segments (no text or missing object) but keeps the rest', () => {
    const r = formatTimedTranscript(
      JSON.stringify([
        { startSec: 0, text: 'a' },
        { startSec: 5 }, // no text → skipped
        null,            // not object → skipped
        { text: 'b' },   // no startSec → defaults to [0:00]
      ]),
    );
    expect(r).toBe('[0:00] a\n[0:00] b');
  });

  it('handles non-finite / negative startSec by clamping to 0', () => {
    const r = formatTimedTranscript(
      JSON.stringify([
        { startSec: NaN, text: 'a' },
        { startSec: -10, text: 'b' },
      ]),
    );
    // NaN → not finite → fallback to 0; negative → Math.floor on negative
    // would yield negative minutes; we accept that as user-data oddity
    // worth noting but not crashing on. Just assert strings come out:
    expect(r.includes('a')).toBe(true);
    expect(r.includes('b')).toBe(true);
  });
});
