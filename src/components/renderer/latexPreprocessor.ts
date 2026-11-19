const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/;

const MATH_ENVS =
  'align\\*?|aligned|equation\\*?|gather\\*?|cases|matrix|pmatrix|bmatrix|vmatrix|Bmatrix|Vmatrix|split';

/**
 * Normalizes LLM LaTeX delimiters (`\(...\)`, `\[...\]`, bare `\begin{align}`,
 * currency literals, and unclosed streaming `$$` blocks) while leaving code blocks untouched.
 */
export function preprocessLatex(input: string, isStreaming = false): string {
  if (!input) return '';

  const protectedSlots: string[] = [];
  const hold = (value: string): string => {
    const token = `\u0000CB_SLOT_${protectedSlots.length}\u0000`;
    protectedSlots.push(value);
    return token;
  };

  // 1. Protect fenced code blocks line-by-line (handles nested/varying fence lengths)
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const outLines: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let fenceBuf: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inFence) {
      const m = FENCE_RE.exec(line);
      if (m) {
        inFence = true;
        fenceChar = m[2][0];
        fenceLen = m[2].length;
        fenceBuf = [line];
        continue;
      }
      outLines.push(line);
    } else {
      fenceBuf.push(line);
      const trimmed = line.trim();
      if (
        trimmed.length >= fenceLen &&
        [...trimmed].every((ch) => ch === fenceChar)
      ) {
        outLines.push(hold(fenceBuf.join('\n')));
        inFence = false;
        fenceBuf = [];
      }
    }
  }

  if (inFence && fenceBuf.length > 0) {
    outLines.push(hold(fenceBuf.join('\n')));
  }

  let text = outLines.join('\n');

  // 2. Protect inline code spans (`...`, ``...``)
  text = text.replace(/(`+)([^`\n]*?)\1/g, (match) => hold(match));

  // 3. Protect escaped dollars (`\$`) temporarily? Leave `\$` as-is so remark-math treats it literally.

  // 4. Convert \[ ... \] display math to $$\n...\n$$
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_match, inner: string) => {
    const trimmed = inner.trim();
    if (!trimmed) return '';
    return `\n$$\n${trimmed}\n$$\n`;
  });

  // 5. Convert \( ... \) inline math to $...$
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_match, inner: string) => {
    const trimmed = inner.trim();
    if (!trimmed) return '';
    return `$${trimmed}$`;
  });

  // 6. Wrap bare top-level \begin{align}...\end{align} etc. when not already inside $$...$$
  // First temporarily protect existing $$...$$ blocks so we don't double-wrap environments inside them
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match) => hold(match));

  const envRegex = new RegExp(
    `\\\\begin\\{(${MATH_ENVS})\\}[\\s\\S]*?\\\\end\\{\\1\\}`,
    'g'
  );
  text = text.replace(envRegex, (match) => hold(`\n$$\n${match.trim()}\n$$\n`));

  // 7. Escape standalone currency like "$100" when it has no valid math closure on the same line
  text = text
    .split('\n')
    .map((line) => {
      // Quick check: skip lines with fewer than 1 unescaped $
      if (!line.includes('$')) return line;
      // Count unescaped $
      const positions: number[] = [];
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '$' && (i === 0 || line[i - 1] !== '\\')) {
          positions.push(i);
        }
      }
      if (positions.length === 1) {
        const pos = positions[0];
        if (/^\$\d/.test(line.slice(pos))) {
          return `${line.slice(0, pos)}\\$${line.slice(pos + 1)}`;
        }
      }
      // If multiple $, check currency-looking "$123 " pairs where content between has spaces & words without math ops
      if (positions.length >= 2) {
        let updated = '';
        let cursor = 0;
        let i = 0;
        while (i < positions.length) {
          const p1 = positions[i];
          const p2 = i + 1 < positions.length ? positions[i + 1] : -1;
          if (p2 !== -1) {
            const between = line.slice(p1 + 1, p2);
            const startsCurrency = /^\d[\d,.]*(?:[kKmMbB%])?(?:\s|$)/.test(between);
            const hasMathOps = /[\\^_{}=+\-*/<>|]/.test(between);
            const hasWords = /\s+[A-Za-z\u4e00-\u9fa5]/.test(between);
            if (startsCurrency && !hasMathOps && hasWords) {
              updated += `${line.slice(cursor, p1)}\\$${line.slice(p1 + 1, p2)}`;
              cursor = p2;
              i += 1;
              continue;
            }
            i += 2;
          } else {
            if (/^\$\d/.test(line.slice(p1))) {
              updated += `${line.slice(cursor, p1)}\\$`;
              cursor = p1 + 1;
            }
            i += 1;
          }
        }
        updated += line.slice(cursor);
        return updated;
      }
      return line;
    })
    .join('\n');

  // Restore protected slots (twice in case envRegex held slots created earlier)
  const restore = (s: string) =>
    s.replace(/\u0000CB_SLOT_(\d+)\u0000/g, (_m, idx) => protectedSlots[Number(idx)] ?? '');

  text = restore(restore(text));

  // 8. Streaming tolerance: close dangling unclosed $$ outside fences
  if (isStreaming) {
    const strippedFences = text.replace(/```[\s\S]*?```/g, '');
    const ddCount = (strippedFences.match(/(?<!\\)\$\$/g) || []).length;
    if (ddCount % 2 === 1) {
      text = `${text}\n$$`;
    }
  }

  return text;
}
