import { describe, expect, it } from 'vitest';
import { SSEParser } from '@/services/llm/sseParser';

describe('SSEParser', () => {
  it('parses events across arbitrary chunk and UTF-8 boundaries', () => {
    const parser = new SSEParser();
    const events1 = parser.feed('event: response.output_text.delta\nda');
    expect(events1).toHaveLength(0);

    const events2 = parser.feed('ta: {"delta":"全加器"}\n\n');
    expect(events2).toEqual([
      {
        event: 'response.output_text.delta',
        data: '{"delta":"全加器"}',
      },
    ]);
  });

  it('supports CRLF, comments, multi-line data, and flush', () => {
    const parser = new SSEParser();
    const out = [
      ...parser.feed(': keep-alive\r\n'),
      ...parser.feed('id: 42\r\nevent: custom\r\ndata: line1\r\ndata: line2\r\n\r\n'),
      ...parser.feed('data: [DONE]'),
      ...parser.flush(),
    ];

    expect(out).toEqual([
      { id: '42', event: 'custom', data: 'line1\nline2' },
      { event: 'message', data: '[DONE]' },
    ]);
  });

  it('does not split an event when \\r\\n crosses a chunk boundary', () => {
    const parser = new SSEParser();
    const first = parser.feed('event: delta\r');
    expect(first).toHaveLength(0);

    const second = parser.feed('\ndata: ok\r\n\r\n');
    expect(second).toEqual([{ event: 'delta', data: 'ok' }]);
  });
});
