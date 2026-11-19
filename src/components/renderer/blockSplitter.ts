const FENCE_OPEN_RE = /^([ \t]*)(`{3,}|~{3,})/;

/**
 * Splits normalized markdown into independent top-level blocks so React.memo
 * avoids re-parsing completed blocks during fast token streaming.
 */
export function splitMarkdownBlocks(markdown: string): string[] {
  if (!markdown) return [];

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let current: string[] = [];

  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let inMathBlock = false;

  const flush = () => {
    const joined = current.join('\n').trim();
    if (joined) blocks.push(joined);
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!inFence && !inMathBlock) {
      const fenceMatch = FENCE_OPEN_RE.exec(line);
      if (fenceMatch) {
        if (current.length > 0 && current[current.length - 1].trim() === '') {
          flush();
        }
        inFence = true;
        fenceChar = fenceMatch[2][0];
        fenceLen = fenceMatch[2].length;
        current.push(line);
        continue;
      }

      if (trimmed.startsWith('$$')) {
        // Single-line $$...$$ stays in place; multi-line $$ starts math block
        const rest = trimmed.slice(2);
        if (!rest.includes('$$')) {
          inMathBlock = true;
        }
        current.push(line);
        continue;
      }

      if (trimmed === '') {
        flush();
      } else {
        current.push(line);
      }
    } else if (inFence) {
      current.push(line);
      if (trimmed.length >= fenceLen && [...trimmed].every((c) => c === fenceChar)) {
        inFence = false;
        flush();
      }
    } else if (inMathBlock) {
      current.push(line);
      if (trimmed.endsWith('$$') && trimmed.length >= 2) {
        inMathBlock = false;
        flush();
      }
    }
  }

  flush();
  return blocks;
}
