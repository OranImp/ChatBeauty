const FENCE_OPEN_RE = /^([ \t]*)(`{3,}(?=[^`\n]*$)|~{3,})/;
const LIST_ITEM_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s/;
const INDENTED_CONT_RE = /^(?: {2,}|\t)\S/;

function isCurrentInList(current: string[]): boolean {
  for (let k = current.length - 1; k >= 0; k--) {
    const l = current[k];
    if (!l.trim()) continue;
    if (LIST_ITEM_RE.test(l)) return true;
    if (!INDENTED_CONT_RE.test(l)) return false;
  }
  return false;
}

function countUnescapedDoubleDollar(line: string): number {
  const withoutInlineCode = line.replace(/`+[^`\n]*`+/g, '');
  const matches = withoutInlineCode.match(/(?<!\\)(?:\\\\)*\$\$/g);
  return matches ? matches.length : 0;
}

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

      if (countUnescapedDoubleDollar(line) % 2 === 1) {
        inMathBlock = true;
        current.push(line);
        continue;
      }

      if (trimmed === '') {
        let nextIdx = i + 1;
        while (nextIdx < lines.length && lines[nextIdx].trim() === '') {
          nextIdx++;
        }
        const nextLine = nextIdx < lines.length ? lines[nextIdx] : '';
        if (
          isCurrentInList(current) &&
          nextLine &&
          (LIST_ITEM_RE.test(nextLine) || INDENTED_CONT_RE.test(nextLine))
        ) {
          current.push(line);
          continue;
        }
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
      if (countUnescapedDoubleDollar(line) % 2 === 1) {
        inMathBlock = false;
        if (!line.startsWith(' ') && !line.startsWith('\t')) {
          flush();
        }
      }
    }
  }

  flush();
  return blocks;
}
