import DOMPurify from 'dompurify';
import { Capacitor } from '@capacitor/core';
import { saveNativeFile } from '@/services/transport/streamHttp';

export type ResolvedTheme = 'oled' | 'dark' | 'light';

const PURE_BLACK = new Set(['#000', '#000000', 'black', 'rgb(0,0,0)', 'rgb(0, 0, 0)']);
const PURE_WHITE = new Set([
  '#fff',
  '#ffffff',
  'white',
  'rgb(255,255,255)',
  'rgb(255, 255, 255)',
]);

function normColor(val: string | null): string {
  return (val || '').trim().toLowerCase();
}

export function sanitizeAndHarmonizeSvg(
  rawSvg: string,
  theme: ResolvedTheme
): { html: string; caption?: string; width: number; height: number } | null {
  const clean = DOMPurify.sanitize(rawSvg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style'],
    FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover'],
  });

  if (typeof DOMParser === 'undefined') {
    return { html: clean, width: 640, height: 340 };
  }

  let normalizedXml = clean;
  const rootOpenMatch = /<svg\b([^>]*)>/i.exec(normalizedXml);
  if (rootOpenMatch) {
    let extraAttrs = '';
    if (!/\bxmlns\s*=/i.test(rootOpenMatch[1])) {
      extraAttrs += ' xmlns="http://www.w3.org/2000/svg"';
    }
    if (/\bxlink:/i.test(normalizedXml) && !/\bxmlns:xlink\s*=/i.test(rootOpenMatch[1])) {
      extraAttrs += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
    }
    if (extraAttrs) {
      normalizedXml = normalizedXml.replace(/<svg\b/i, `<svg${extraAttrs}`);
    }
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(normalizedXml, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    return null;
  }
  const svg = doc.querySelector('svg');
  if (!svg) {
    return null;
  }

  let caption: string | undefined;
  const titleEl = svg.querySelector('title');
  if (titleEl?.textContent?.trim()) {
    caption = titleEl.textContent.trim();
  }

  // Ensure viewBox exists for crisp scaling
  let width = 640;
  let height = 340;
  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      width = parts[2];
      height = parts[3];
    }
  } else {
    const wAttr = parseFloat(svg.getAttribute('width') || '');
    const hAttr = parseFloat(svg.getAttribute('height') || '');
    if (wAttr > 0 && hAttr > 0) {
      width = wAttr;
      height = hAttr;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    } else {
      svg.setAttribute('viewBox', '0 0 640 340');
    }
  }

  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('style', 'width: 100%; height: auto; display: block;');

  const isDark = theme !== 'light';

  // Remove opaque full-bleed background rects so SVG blends cleanly into card
  const firstRect = svg.querySelector(':scope > rect');
  if (firstRect) {
    const fill = normColor(firstRect.getAttribute('fill'));
    const rw = firstRect.getAttribute('width');
    const rh = firstRect.getAttribute('height');
    const looksFull =
      rw === '100%' ||
      rh === '100%' ||
      (parseFloat(rw || '0') >= width * 0.9 && parseFloat(rh || '0') >= height * 0.9);
    if (looksFull && ((isDark && PURE_WHITE.has(fill)) || (!isDark && PURE_BLACK.has(fill)))) {
      firstRect.setAttribute('fill', 'transparent');
    }
  }

  // Harmonize explicit black/white strokes & fills against current theme
  // and protect labels from intersecting wires with a crisp theme-background halo.
  const allNodes = svg.querySelectorAll('*');
  allNodes.forEach((el) => {
    const tagLower = el.tagName.toLowerCase();
    if (tagLower === 'image') {
      for (const attr of ['href', 'xlink:href']) {
        const refVal = (el.getAttribute(attr) || '').trim();
        if (/^(https?:)?\/\//i.test(refVal)) {
          el.removeAttribute(attr);
        }
      }
    }

    const stroke = normColor(el.getAttribute('stroke'));
    const fill = normColor(el.getAttribute('fill'));

    if (isDark) {
      if (PURE_BLACK.has(stroke)) el.setAttribute('stroke', 'currentColor');
      if (PURE_BLACK.has(fill)) el.setAttribute('fill', 'currentColor');
    } else {
      if (PURE_WHITE.has(stroke)) el.setAttribute('stroke', 'currentColor');
      if (PURE_WHITE.has(fill)) el.setAttribute('fill', 'currentColor');
    }

    if (el.tagName.toLowerCase() === 'text' && (!stroke || stroke === 'none')) {
      const existingStyle = (el.getAttribute('style') || '').trim();
      const sep = existingStyle && !existingStyle.endsWith(';') ? '; ' : existingStyle ? ' ' : '';
      el.setAttribute(
        'style',
        `${existingStyle}${sep}paint-order: stroke fill; stroke: var(--bg); stroke-width: 4px; stroke-linejoin: round;`
      );
    }
  });

  return {
    html: svg.outerHTML,
    caption,
    width,
    height,
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function triggerDownload(filename: string, dataUrlOrBlob: string | Blob): void {
  if (typeof dataUrlOrBlob === 'string' && /^https?:\/\//i.test(dataUrlOrBlob)) {
    void (async () => {
      try {
        const res = await fetch(dataUrlOrBlob);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        triggerDownload(filename, blob);
      } catch {
        if (typeof window !== 'undefined' && !Capacitor.isNativePlatform()) {
          const a = document.createElement('a');
          a.href = dataUrlOrBlob;
          a.download = filename;
          a.rel = 'noopener noreferrer';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      }
    })();
    return;
  }

  if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
    void (async () => {
      if (typeof dataUrlOrBlob === 'string') {
        const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrlOrBlob);
        if (match) {
          await saveNativeFile({ filename, mimeType: match[1], base64: match[2] });
        }
      } else {
        const base64 = await blobToBase64(dataUrlOrBlob);
        await saveNativeFile({
          filename,
          mimeType: dataUrlOrBlob.type || 'application/octet-stream',
          base64,
        });
      }
    })();
    return;
  }

  const url =
    typeof dataUrlOrBlob === 'string' ? dataUrlOrBlob : URL.createObjectURL(dataUrlOrBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (typeof dataUrlOrBlob !== 'string') {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function exportSvgToPng(
  svgHtml: string,
  filename: string,
  theme: ResolvedTheme
): Promise<void> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgHtml, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) return;

  const vb = (svg.getAttribute('viewBox') || '0 0 640 340').trim().split(/[\s,]+/).map(Number);
  const w = vb[2] > 0 ? vb[2] : 640;
  const h = vb[3] > 0 ? vb[3] : 340;
  const fg = theme === 'light' ? '#1f1e1c' : theme === 'oled' ? '#f2f0eb' : '#eceae4';
  const bg = theme === 'oled' ? '#000000' : theme === 'dark' ? '#171615' : '#faf9f5';
  const surface = theme === 'oled' ? '#141312' : theme === 'dark' ? '#21201e' : '#f2f0e9';
  const muted = theme === 'light' ? '#6f6a62' : theme === 'oled' ? '#9b968e' : '#9c968c';
  const accent = theme === 'light' ? '#c25d36' : '#d9825b';
  const border = theme === 'light' ? 'rgba(31,30,28,0.12)' : 'rgba(236,234,228,0.12)';

  const exportSvg = svg.cloneNode(true) as SVGSVGElement;
  exportSvg.setAttribute('width', String(w * 2));
  exportSvg.setAttribute('height', String(h * 2));
  exportSvg.setAttribute('style', `color: ${fg}; background: ${bg};`);

  // Replace currentColor and theme CSS vars explicitly for standalone rasterization
  let serialized = exportSvg.outerHTML
    .replace(/currentColor/g, fg)
    .replace(/var\(--bg(?:\s*,[^)]+)?\)/g, bg)
    .replace(/var\(--fg(?:\s*,[^)]+)?\)/g, fg)
    .replace(/var\(--surface(?:\s*,[^)]+)?\)/g, surface)
    .replace(/var\(--muted(?:\s*,[^)]+)?\)/g, muted)
    .replace(/var\(--accent(?:\s*,[^)]+)?\)/g, accent)
    .replace(/var\(--border(?:\s*,[^)]+)?\)/g, border);
  if (!/^<svg\b[^>]*\bxmlns\s*=/i.test(serialized)) {
    serialized = serialized.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const blobUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = blobUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * 2);
    canvas.height = Math.round(h * 2);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const pngUrl = canvas.toDataURL('image/png');
    triggerDownload(filename, pngUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
