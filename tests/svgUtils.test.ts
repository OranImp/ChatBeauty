// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeAndHarmonizeSvg } from '@/components/renderer/svgUtils';

const USER_RC_CIRCUIT_SVG = `<svg viewBox="0 0 640 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="RC低通滤波电路图">
  <g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M72 100 H205"/>
    <path d="M295 100 H430"/>
    <path d="M430 100 H520"/>
    <path d="M205 100 L215 84 L230 116 L245 84 L260 116 L275 84 L295 100"/>
    <path d="M430 100 V145"/>
    <path d="M400 145 H460"/>
    <path d="M400 161 H460"/>
    <path d="M430 161 V201"/>
    <path d="M405 201 H455"/>
    <path d="M413 211 H447"/>
    <path d="M421 221 H439"/>
    <circle cx="430" cy="100" r="4" fill="currentColor" stroke="none"/>
  </g>
  <g fill="currentColor" font-family="sans-serif" font-size="16">
    <text x="48" y="105" text-anchor="end">Vin</text>
    <text x="535" y="105">Vout</text>
    <text x="250" y="68" text-anchor="middle">R</text>
    <text x="430" y="137" text-anchor="middle">C</text>
    <text x="430" y="248" text-anchor="middle">GND</text>
  </g>
</svg>`;

describe('svgUtils.sanitizeAndHarmonizeSvg', () => {
  it('preserves circuit viewBox/labels and applies stroke-halo protection on text elements', () => {
    const res = sanitizeAndHarmonizeSvg(USER_RC_CIRCUIT_SVG, 'dark');
    expect(res).not.toBeNull();
    expect(res?.width).toBe(640);
    expect(res?.height).toBe(260);

    const parser = new DOMParser();
    const doc = parser.parseFromString(res!.html, 'image/svg+xml');
    const texts = Array.from(doc.querySelectorAll('text'));
    expect(texts.map((t) => t.textContent)).toEqual(['Vin', 'Vout', 'R', 'C', 'GND']);

    for (const t of texts) {
      const style = t.getAttribute('style') || '';
      expect(style).toContain('paint-order: stroke fill');
      expect(style).toContain('stroke: var(--bg)');
      expect(style).toContain('stroke-width: 4px');
      expect(style).toContain('stroke-linejoin: round');
    }
  });

  it('strips dangerous scripts and event handler attributes cleanly', () => {
    const unsafeSvg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <script>alert("xss")</script>
      <circle cx="50" cy="50" r="20" onclick="alert(1)" stroke="#000" fill="#fff"/>
      <text x="50" y="50" stroke="none">OK</text>
    </svg>`;

    const res = sanitizeAndHarmonizeSvg(unsafeSvg, 'dark');
    expect(res).not.toBeNull();
    expect(res?.html).not.toContain('<script');
    expect(res?.html).not.toContain('onclick');
    expect(res?.html).toContain('paint-order: stroke fill');
    expect(res?.html).toContain('currentColor');
  });

  it('strips <style> tags, removes external <image> URLs, and ensures xmlns on SVG root', () => {
    const riskySvg = `<svg viewBox="0 0 120 80">
      <style>rect { fill: url(https://evil.test/track); }</style>
      <image href="https://evil.test/pixel.png" width="10" height="10"/>
      <image xlink:href="//evil.test/proto.png" width="10" height="10"/>
      <rect width="120" height="80" fill="#ffffff"/>
    </svg>`;

    const res = sanitizeAndHarmonizeSvg(riskySvg, 'dark');
    expect(res).not.toBeNull();
    expect(res?.html).not.toContain('<style');
    expect(res?.html).not.toContain('evil.test');
    expect(res?.html).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});
