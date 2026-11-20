import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE_SETTINGS } from '@/types/settings';

const mockGetRuntimeEnvironment = vi.fn<() => 'electron' | 'capacitor' | 'web'>();

vi.mock('@/services/transport/streamHttp', () => ({
  getRuntimeEnvironment: () => mockGetRuntimeEnvironment(),
  getAndroidBatteryStatus: vi.fn(async () => ({ ignoring: false, supported: true })),
  openAndroidBatterySettings: vi.fn(async () => true),
}));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: () => ({
    appearance: DEFAULT_APPEARANCE_SETTINGS,
    updateAppearance: vi.fn(async () => undefined),
  }),
}));

import { AppearanceTab } from '@/components/settings/AppearanceTab';

describe('AppearanceTab platform-aware keep-alive visibility', () => {
  beforeEach(() => {
    mockGetRuntimeEnvironment.mockReset();
  });

  it('shows desktop tray settings and hides mobile battery settings on Electron', () => {
    mockGetRuntimeEnvironment.mockReturnValue('electron');
    const html = renderToStaticMarkup(createElement(AppearanceTab));
    expect(html).toContain('启用后台持续生成');
    expect(html).toContain('关闭窗口最小化到托盘');
    expect(html).not.toContain('手机端后台保活');
  });

  it('shows mobile battery keep-alive settings and hides desktop tray settings on Capacitor Android', () => {
    mockGetRuntimeEnvironment.mockReturnValue('capacitor');
    const html = renderToStaticMarkup(createElement(AppearanceTab));
    expect(html).toContain('启用后台持续生成');
    expect(html).toContain('手机端后台保活');
    expect(html).not.toContain('关闭窗口最小化到托盘');
  });

  it('hides both native keep-alive sections on plain Web', () => {
    mockGetRuntimeEnvironment.mockReturnValue('web');
    const html = renderToStaticMarkup(createElement(AppearanceTab));
    expect(html).not.toContain('启用后台持续生成');
    expect(html).not.toContain('手机端后台保活');
    expect(html).not.toContain('关闭窗口最小化到托盘');
  });
});
