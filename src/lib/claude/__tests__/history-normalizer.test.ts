import {
  buildPromptWithHistory,
  extractToolResultText,
  normalizeHistoryMessageForFallback,
  previewToolInput,
  renderFileDirective,
  truncateHistoryText,
  FALLBACK_HISTORY_MESSAGE_MAX_CHARS,
} from '../history-normalizer';

describe('truncateHistoryText', () => {
  it('returns input unchanged when within budget', () => {
    expect(truncateHistoryText('hello', 100)).toBe('hello');
  });

  it('hard-caps at maxChars and ends with a truncation marker', () => {
    const text = 'a'.repeat(50);
    const out = truncateHistoryText(text, 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out).toContain('truncated');
  });
});

describe('extractToolResultText', () => {
  it('returns string content as-is', () => {
    expect(extractToolResultText('hello')).toBe('hello');
  });

  it('flattens array of text blocks', () => {
    expect(extractToolResultText([
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
    ])).toBe('one\ntwo');
  });

  it('treats string entries inside arrays as text', () => {
    expect(extractToolResultText(['raw', { type: 'text', text: 'block' }])).toBe('raw\nblock');
  });

  it('falls back to JSON for unknown shapes', () => {
    expect(extractToolResultText({ ok: true })).toBe('{"ok":true}');
  });

  it('returns empty for null / undefined', () => {
    expect(extractToolResultText(null)).toBe('');
    expect(extractToolResultText(undefined)).toBe('');
  });

  it('summarizes serialized image content-blocks instead of echoing base64', () => {
    const serialized = JSON.stringify([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BASE64DATA' } },
      { type: 'text', text: 'Loaded x.png (image/png, 1KB).' },
    ]);
    const out = extractToolResultText(serialized);
    expect(out).not.toContain('BASE64DATA');
    expect(out).toContain('Loaded x.png');
    expect(out).toContain('image/png');
  });

  it('marks inline image blocks in array content', () => {
    const out = extractToolResultText([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'XX' } },
      { type: 'text', text: 'hi' },
    ]);
    expect(out).not.toContain('XX');
    expect(out).toContain('hi');
  });
});

describe('previewToolInput', () => {
  it('serializes object inputs to JSON', () => {
    expect(previewToolInput({ a: 1 })).toBe('{"a":1}');
  });

  it('truncates oversized inputs with an ellipsis marker', () => {
    const big = { text: 'x'.repeat(800) };
    const preview = previewToolInput(big, 100);
    expect(preview.length).toBeLessThanOrEqual(101); // 100 + the ellipsis
    expect(preview.endsWith('…')).toBe(true);
  });

  it('returns empty for nullish inputs', () => {
    expect(previewToolInput(undefined)).toBe('');
    expect(previewToolInput(null)).toBe('');
  });
});

describe('renderFileDirective', () => {
  it('renders each attached file as a single descriptor line with the on-disk path', () => {
    const raw = '<!--files:[{"id":"a","name":"foo.m4a","type":"audio/m4a","size":100,"filePath":"/abs/foo.m4a"}]-->the user said something';
    const result = renderFileDirective(raw);
    expect(result).not.toBeNull();
    expect(result!.lines).toEqual([
      '[Attached file: name="foo.m4a", path=/abs/foo.m4a, type=audio/m4a]',
    ]);
    expect(result!.rest).toBe('the user said something');
  });

  it('returns null when input is not a files directive', () => {
    expect(renderFileDirective('plain text')).toBeNull();
  });

  it('returns null when the JSON payload is malformed', () => {
    expect(renderFileDirective('<!--files:[bad json-->trailing')).toBeNull();
  });

  it('skips entries that are not plain objects', () => {
    const raw = '<!--files:[null, {"name":"ok.txt","filePath":"/p"}]-->';
    expect(renderFileDirective(raw)!.lines).toEqual([
      '[Attached file: name="ok.txt", path=/p]',
    ]);
  });
});

describe('normalizeHistoryMessageForFallback', () => {
  it('keeps assistant text blocks verbatim', () => {
    const content = JSON.stringify([{ type: 'text', text: 'hi there' }]);
    const out = normalizeHistoryMessageForFallback({ role: 'assistant', content });
    expect(out).toBe('hi there');
  });

  it('renders tool_use blocks with name and a JSON preview of the input', () => {
    const content = JSON.stringify([
      { type: 'tool_use', id: 'x', name: 'transcribe_audio', input: { file_path: '/abs/foo.m4a' } },
    ]);
    const out = normalizeHistoryMessageForFallback({ role: 'assistant', content });
    expect(out).toBe('[Called tool transcribe_audio({"file_path":"/abs/foo.m4a"})]');
  });

  it('preserves tool_result text up to the per-message budget (regression: used to be dropped entirely)', () => {
    const transcript = 'a'.repeat(50_000);
    const content = JSON.stringify([
      { type: 'tool_use', id: 'x', name: 'transcribe_audio', input: { file_path: '/p' } },
      { type: 'tool_result', tool_use_id: 'x', content: transcript },
    ]);
    const out = normalizeHistoryMessageForFallback({ role: 'assistant', content });
    expect(out).toContain('[Called tool transcribe_audio');
    expect(out).toContain('[Tool result:');
    expect(out).toContain('a'.repeat(100)); // a representative chunk survives
    expect(out).toContain('truncated');     // and we mark where it stopped
    expect(out.length).toBeLessThanOrEqual(FALLBACK_HISTORY_MESSAGE_MAX_CHARS); // hard cap, not "cap + marker"
  });

  it('tags tool errors distinctly', () => {
    const content = JSON.stringify([
      { type: 'tool_result', tool_use_id: 'x', content: 'denied', is_error: true },
    ]);
    expect(normalizeHistoryMessageForFallback({ role: 'assistant', content }))
      .toBe('[Tool error: denied]');
  });

  it('renders <!--files:...--> directives on user messages, surfacing the absolute file path', () => {
    const raw = '<!--files:[{"id":"a","name":"foo.m4a","type":"audio/m4a","size":100,"filePath":"/abs/foo.m4a"}]--><!--source:wechat-->[文件: foo.m4a]';
    const out = normalizeHistoryMessageForFallback({ role: 'user', content: raw });
    expect(out).toContain('[Attached file: name="foo.m4a", path=/abs/foo.m4a, type=audio/m4a]');
    expect(out).toContain('[文件: foo.m4a]');
    expect(out).not.toContain('<!--source:wechat-->');
  });

  it('falls back to plain truncation for non-JSON assistant content', () => {
    const out = normalizeHistoryMessageForFallback({ role: 'assistant', content: 'plain reply' });
    expect(out).toBe('plain reply');
  });
});

describe('buildPromptWithHistory', () => {
  it('returns the prompt unchanged when there is no history', () => {
    expect(buildPromptWithHistory('hello', [])).toBe('hello');
    expect(buildPromptWithHistory('hello')).toBe('hello');
  });

  it('wraps history newest-last inside <conversation_history>', () => {
    const out = buildPromptWithHistory('next turn', [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'second' },
    ]);
    const lines = out.split('\n');
    expect(lines[0]).toBe('<conversation_history>');
    expect(lines).toContain('Human: first');
    expect(lines).toContain('Assistant: ok');
    expect(lines).toContain('Human: second');
    expect(lines[lines.length - 1]).toBe('next turn');
  });

  it('includes attached file paths in the rendered history (regression)', () => {
    const out = buildPromptWithHistory('what does it say?', [
      {
        role: 'user',
        content: '<!--files:[{"name":"foo.m4a","filePath":"/abs/foo.m4a","type":"audio/m4a"}]--><!--source:wechat-->[文件: foo.m4a]',
      },
    ]);
    expect(out).toContain('/abs/foo.m4a');
  });

  it('preserves prior tool_result text so the next turn does not re-invoke the tool blindly (regression)', () => {
    const transcript = '会议讨论了数据库安全...';
    const assistantContent = JSON.stringify([
      { type: 'tool_use', id: 'x', name: 'transcribe_audio', input: { file_path: '/abs/foo.m4a' } },
      { type: 'tool_result', tool_use_id: 'x', content: transcript },
      { type: 'text', text: '已转录完成,主要内容是...' },
    ]);
    const out = buildPromptWithHistory('帮我把转录整成 word', [
      { role: 'user', content: '<!--files:[{"name":"foo.m4a","filePath":"/abs/foo.m4a"}]-->[文件: foo.m4a]' },
      { role: 'assistant', content: assistantContent },
    ]);
    expect(out).toContain('/abs/foo.m4a');
    expect(out).toContain(transcript);
    expect(out).toContain('[Called tool transcribe_audio');
  });
});
