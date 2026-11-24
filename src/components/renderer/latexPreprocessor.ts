const FENCE_RE = /^([ \t]*)(`{3,}(?=[^`\n]*$)|~{3,})([^\n]*)$/;

const MATH_ENVS =
  'align\\*?|aligned|equation\\*?|gather\\*?|cases|matrix|pmatrix|bmatrix|vmatrix|Bmatrix|Vmatrix|split';

function protectInlineCodeSpans(text: string, hold: (value: string) => string): string {
  let out = '';
  let i = 0;
  const len = text.length;

  while (i < len) {
    if (text[i] === '`') {
      let openLen = 1;
      while (i + openLen < len && text[i + openLen] === '`') openLen++;

      let j = i + openLen;
      let closeStart = -1;
      while (j < len) {
        if (text[j] === '\n') {
          let k = j + 1;
          while (k < len && (text[k] === ' ' || text[k] === '\t')) k++;
          if (k < len && text[k] === '\n') break;
        }
        if (text[j] === '`') {
          let runLen = 1;
          while (j + runLen < len && text[j + runLen] === '`') runLen++;
          if (runLen === openLen) {
            closeStart = j;
            break;
          }
          j += runLen;
          continue;
        }
        j++;
      }

      if (closeStart !== -1) {
        const spanEnd = closeStart + openLen;
        out += hold(text.slice(i, spanEnd));
        i = spanEnd;
        continue;
      }

      out += text.slice(i, i + openLen);
      i += openLen;
      continue;
    }

    out += text[i];
    i++;
  }

  return out;
}

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

  // 2. Protect inline code spans (`...`, ``...``, multi-line) per CommonMark
  text = protectInlineCodeSpans(text, hold);

  // 3. Protect existing $$...$$ blocks before normalizing bare environments or \[...\]
  text = text.replace(/((?<!\\)(?:\\\\)*)\$\$([\s\S]*?(?<!\\)(?:\\\\)*)\$\$/g, (_m, prefix: string, body: string) => {
    return `${prefix}${hold(`$$${body}$$`)}`;
  });

  // 4. Wrap and protect bare top-level \begin{align}...\end{align} BEFORE \[...\] so inner \\[6pt] stays intact
  const envRegex = new RegExp(
    `((?<!\\\\)(?:\\\\\\\\)*)(\\\\begin\\{(${MATH_ENVS})\\}(?:[^\\\\]|\\\\[\\s\\S])*?\\\\end\\{\\3\\})`,
    'g'
  );
  text = text.replace(envRegex, (_m, prefix: string, block: string) => {
    return `${prefix}${hold(`\n$$\n${block.trim()}\n$$\n`)}`;
  });

  // 5. Convert \[ ... \] display math to $$\n...\n$$ and protect it (even backslash count guard)
  text = text.replace(/((?<!\\)(?:\\\\)*)\\\[((?:[^\\]|\\[\s\S])*?)\\\]/g, (_m, prefix: string, inner: string) => {
    const trimmed = inner.trim();
    if (!trimmed) return prefix;
    return `${prefix}${hold(`\n$$\n${trimmed}\n$$\n`)}`;
  });

  // 6. Convert \( ... \) inline math to $...$ and protect from currency escaping
  text = text.replace(/((?<!\\)(?:\\\\)*)\\\(((?:[^\\]|\\[\s\S])*?)\\\)/g, (_m, prefix: string, inner: string) => {
    const trimmed = inner.trim();
    if (!trimmed) return prefix;
    return `${prefix}${hold(`$${trimmed}$`)}`;
  });

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

  // 8. Streaming tolerance: close dangling unclosed $$ BEFORE restoring protected code/math slots
  if (isStreaming) {
    const ddCount = (text.match(/(?<!\\)(?:\\\\)*\$\$/g) || []).length;
    if (ddCount % 2 === 1) {
      text = `${text}\n$$`;
    }
  }

  // Restore protected slots (up to 5 passes for nested protections)
  const restore = (s: string) =>
    s.replace(/\u0000CB_SLOT_(\d+)\u0000/g, (_m, idx) => protectedSlots[Number(idx)] ?? '');

  for (let pass = 0; pass < 5 && /\u0000CB_SLOT_\d+\u0000/.test(text); pass++) {
    text = restore(text);
  }

  return text;
}
