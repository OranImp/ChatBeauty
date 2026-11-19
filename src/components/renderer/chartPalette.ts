import type { ResolvedTheme } from './svgUtils';

/**
 * Low-saturation, editorial data-visualization palettes tuned for long reading
 * without eye fatigue, while keeping series clearly distinguishable.
 */
export const DARK_CHART_PALETTE: readonly string[] = [
  '#d9825b', // Warm terracotta (primary)
  '#6fb39c', // Celadon sage
  '#d9b566', // Warm ochre gold
  '#8fa6cb', // Muted slate blue-grey
  '#c48fa8', // Dusty rose
  '#a8a29e', // Warm stone
];

export const LIGHT_CHART_PALETTE: readonly string[] = [
  '#c25d36', // Deep terracotta
  '#3d7f6a', // Deep celadon sage
  '#a87d24', // Ochre bronze
  '#4f6d9a', // Slate steel
  '#9b5978', // Muted plum
  '#57534e', // Warm charcoal grey
];

export interface ChartChromeTokens {
  fg: string;
  mutedFg: string;
  gridLine: string;
  tooltipBg: string;
  tooltipBorder: string;
}

export function getChartPalette(theme: ResolvedTheme): string[] {
  return [...(theme === 'light' ? LIGHT_CHART_PALETTE : DARK_CHART_PALETTE)];
}

export function getChartChromeTokens(theme: ResolvedTheme): ChartChromeTokens {
  if (theme === 'light') {
    return {
      fg: '#1f1e1c',
      mutedFg: '#6f6a62',
      gridLine: 'rgba(31, 30, 28, 0.08)',
      tooltipBg: '#ffffff',
      tooltipBorder: 'rgba(31, 30, 28, 0.14)',
    };
  }
  return {
    fg: theme === 'oled' ? '#f2f0eb' : '#eceae4',
    mutedFg: theme === 'oled' ? '#9b968e' : '#9c968c',
    gridLine: 'rgba(236, 234, 228, 0.08)',
    tooltipBg: theme === 'oled' ? '#141312' : '#21201e',
    tooltipBorder: 'rgba(236, 234, 228, 0.14)',
  };
}
