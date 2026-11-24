import { describe, expect, it } from 'vitest';
import { preprocessLatex } from '@/components/renderer/latexPreprocessor';
import { splitMarkdownBlocks } from '@/components/renderer/blockSplitter';

describe('preprocessLatex', () => {
  it('converts \\[...\\] and \\(...\\) to $$ and $ delimiters', () => {
    const src = '计算 \\(S_1 + C_{in}\\) 得到：\n\\[\nS = S_1 \\oplus C_{in}\n\\]';
    const out = preprocessLatex(src);
    expect(out).toContain('$S_1 + C_{in}$');
    expect(out).toContain('$$\nS = S_1 \\oplus C_{in}\n$$');
  });

  it('wraps bare \\begin{aligned} environments in $$...$$', () => {
    const src = '\\begin{aligned}\na &= b + c \\\\\nd &= e\n\\end{aligned}';
    const out = preprocessLatex(src);
    expect(out.trim().startsWith('$$')).toBe(true);
    expect(out.trim().endsWith('$$')).toBe(true);
    expect(out).toContain('\\begin{aligned}');
  });

  it('does not double-wrap environments already inside $$...$$', () => {
    const src = '$$\n\\begin{cases}\nx = 1 \\\\\ny = 2\n\\end{cases}\n$$';
    const out = preprocessLatex(src);
    expect(out.match(/\$\$/g)?.length).toBe(2);
  });

  it('preserves fenced code blocks and inline code spans untouched', () => {
    const src = [
      'Here is `\\[not math\\]` inline.',
      '```tex',
      '\\[x = y\\]',
      '```',
      'And real math: \\(x = y\\).',
    ].join('\n');
    const out = preprocessLatex(src);
    expect(out).toContain('`\\[not math\\]`');
    expect(out).toContain('```tex\n\\[x = y\\]\n```');
    expect(out).toContain('And real math: $x = y$.');
  });

  it('protects standalone currency values without breaking math', () => {
    const src = 'The GPU costs $1999 in the US, and $E = mc^2$ holds.';
    const out = preprocessLatex(src);
    expect(out).toContain('\\$1999');
    expect(out).toContain('$E = mc^2$');
  });

  it('closes unclosed $$ blocks gracefully when streaming', () => {
    const src = 'Step 1:\n$$\nC_{out} = C_1 + C_2';
    const out = preprocessLatex(src, true);
    expect(out.endsWith('\n$$')).toBe(true);
  });

  it('does not corrupt \\[spacing] inside existing $$...$$ blocks and keeps indented list math intact', () => {
    const src = '$$\n\\begin{aligned}\na &= b \\\\[6pt]\nc &= d\n\\end{aligned}\n\\] trailing $$';
    const out = preprocessLatex(src);
    expect(out.match(/\$\$/g)?.length).toBe(2);

    const listMd = [
      '1. First item:',
      '   $$',
      '   E = mc^2',
      '   $$',
      '2. Second item',
    ].join('\n');
    expect(splitMarkdownBlocks(listMd)).toHaveLength(1);
  });

  it('handles Wave 4 regressions: backtick info guard, CommonMark multi-backtick spans, bare aligned with \\[6pt], and streaming fenced $$', () => {
    const inlineWithFenceLookalike = '```foo`bar` still inline\n\\(a+b\\)';
    expect(preprocessLatex(inlineWithFenceLookalike)).toContain('$a+b$');

    const multiBacktickSpan = 'Inline ``a ` \\(not math\\) b`` ends here and \\(real\\)';
    const outSpan = preprocessLatex(multiBacktickSpan);
    expect(outSpan).toContain('``a ` \\(not math\\) b``');
    expect(outSpan).toContain('$real$');

    const bareAligned = '\\begin{aligned}\nx &= 1 \\\\[6pt]\ny &= 2\n\\end{aligned}';
    const outBare = preprocessLatex(bareAligned);
    expect(outBare).toContain('\\\\[6pt]');
    expect(outBare.match(/\$\$/g)?.length).toBe(2);

    const streamingFenceWithDD = '```tex\n$$ unclosed formula inside code fence';
    const outFence = preprocessLatex(streamingFenceWithDD, true);
    expect(outFence.endsWith('\n$$')).toBe(false);
  });

  it('preserves loose lists, closing $$ punctuation, inline $$ openers, and splits indented code after plain paragraphs', () => {
    const looseList = ['1. First item', '', '   continuation', '', '2. Second item'].join('\n');
    expect(splitMarkdownBlocks(looseList)).toHaveLength(1);

    const mathWithPeriod = ['- Formula: $$', '  x = 1', '  $$.', '', 'Next paragraph'].join('\n');
    const mathBlocks = splitMarkdownBlocks(mathWithPeriod);
    expect(mathBlocks).toHaveLength(2);
    expect(mathBlocks[1]).toBe('Next paragraph');

    const paraThenIndentedCode = ['Plain paragraph.', '', '    const code = 1;'].join('\n');
    expect(splitMarkdownBlocks(paraThenIndentedCode)).toHaveLength(2);
  });
});
