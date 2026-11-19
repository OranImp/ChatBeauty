import { describe, expect, it } from 'vitest';
import { getChartChromeTokens, getChartPalette } from '@/components/renderer/chartPalette';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

describe('chartPalette', () => {
  it.each(['oled', 'dark', 'light'] as const)(
    'returns at least 5 distinct hex colors for %s theme',
    (theme) => {
      const palette = getChartPalette(theme);
      expect(palette.length).toBeGreaterThanOrEqual(5);
      for (const color of palette) {
        expect(color).toMatch(HEX_COLOR_RE);
      }
      expect(new Set(palette).size).toBe(palette.length);
    }
  );

  it('returns valid chrome tokens across all resolved themes', () => {
    for (const theme of ['oled', 'dark', 'light'] as const) {
      const tokens = getChartChromeTokens(theme);
      expect(tokens.fg).toBeTruthy();
      expect(tokens.mutedFg).toBeTruthy();
      expect(tokens.gridLine).toBeTruthy();
      expect(tokens.tooltipBg).toBeTruthy();
      expect(tokens.tooltipBorder).toBeTruthy();
    }
  });
});
