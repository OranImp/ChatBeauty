// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_CONTEXT_SETTINGS,
  DEFAULT_GENERATION_SETTINGS,
  DEFAULT_MEMORY_SETTINGS,
} from '@/types/settings';
import { MEMORY_FILE_HEADER } from '@/services/memory/memoryEngine';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockStore = {
  providers: [
    {
      id: 'prov-1',
      name: 'OpenAI Official',
      protocol: 'openai-chat' as const,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test-key',
      defaultModel: 'gpt-6.2-sol',
      models: [{ id: 'gpt-6.2-sol', name: 'gpt-6.2-sol' }],
      enabled: true,
      createdAt: 1,
    },
  ],
  activeProviderId: 'prov-1',
  activeModelId: 'gpt-6.2-sol',
  generation: DEFAULT_GENERATION_SETTINGS,
  modelProfileSync: {
    remoteUrl: '',
    remoteRules: [],
    customRules: [],
  },
  promptPresets: [
    {
      id: 'preset_default',
      name: '标准学术导师',
      description: '适合多步推导与教学可视化',
      content: 'You are a helpful academic tutor.',
      isBuiltIn: true,
      category: 'academic' as const,
      updatedAt: 1,
    },
    {
      id: 'preset_custom',
      name: '精简架构师',
      description: '直击要点与代码结构',
      content: 'Respond concisely.',
      isBuiltIn: false,
      category: 'custom' as const,
      updatedAt: 2,
    },
  ],
  promptSettings: {
    defaultPresetId: 'preset_default',
    renderEnhancementEnabled: true,
    renderEnhancementPrompt: 'DEFAULT_ENHANCE_PROMPT',
  },
  appearance: DEFAULT_APPEARANCE_SETTINGS,
  contextSettings: DEFAULT_CONTEXT_SETTINGS,
  memorySettings: DEFAULT_MEMORY_SETTINGS,
  memoryDocument: MEMORY_FILE_HEADER,
  memoryEntries: [],
  compactingByConv: {},
  memoryNotice: null,
  webdav: {
    enabled: false,
    endpoint: '',
    username: '',
    password: '',
    remotePath: '/ChatBeauty/backup.json',
  },
  conversations: [],
  messagesByConv: {},
  activeConversationId: null,
  saveProvider: vi.fn(async () => undefined),
  deleteProvider: vi.fn(async () => undefined),
  setActiveProviderModel: vi.fn(async () => undefined),
  fetchProviderModels: vi.fn(async () => []),
  testProviderConnection: vi.fn(async () => ({ ok: true, message: 'ok' })),
  updateGeneration: vi.fn(async () => undefined),
  updateContextSettings: vi.fn(async () => undefined),
  updateModelProfileSync: vi.fn(async () => undefined),
  syncRemoteModelProfiles: vi.fn(async () => ({ ok: true, message: 'ok', count: 0 })),
  saveCustomModelProfileRules: vi.fn(async () => undefined),
  updateMemorySettings: vi.fn(async () => undefined),
  saveMemoryDocument: vi.fn(async () => undefined),
  upsertMemoryEntry: vi.fn(async () => undefined),
  deleteMemoryEntry: vi.fn(async () => undefined),
  clearAllMemories: vi.fn(async () => undefined),
  clearMemoryNotice: vi.fn(),
  compactConversation: vi.fn(async () => ({ ok: true, message: 'ok' })),
  savePromptPreset: vi.fn(async () => undefined),
  deletePromptPreset: vi.fn(async () => undefined),
  resetBuiltinPreset: vi.fn(async () => undefined),
  updatePromptSettings: vi.fn(async () => undefined),
  updateAppearance: vi.fn(async () => undefined),
  updateWebDav: vi.fn(async () => undefined),
  reloadFromDatabase: vi.fn(async () => undefined),
  openDemoShowcase: vi.fn(async () => undefined),
};

vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector?: (s: typeof mockStore) => unknown) =>
    selector ? selector(mockStore) : mockStore,
}));

vi.mock('@/services/transport/streamHttp', () => ({
  getRuntimeEnvironment: () => 'web',
  getAndroidBatteryStatus: vi.fn(async () => ({ ignoring: false, supported: false })),
  openAndroidBatterySettings: vi.fn(async () => false),
}));

import { SettingsModal, type SettingsTabKey } from '@/components/settings/SettingsModal';
import { PromptsTab } from '@/components/settings/PromptsTab';

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches: query.includes('767px') ? width <= 767 : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
    configurable: true,
    writable: true,
  });
}

describe('Settings two-level ChatGPT navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders full-screen settings with 3 grouped categories and all 8 Level-1 entries on Desktop', () => {
    setViewportWidth(1280);
    const onTabChange = vi.fn();

    act(() => {
      root.render(
        createElement(SettingsModal, {
          open: true,
          activeTab: 'providers',
          onTabChange,
          onClose: vi.fn(),
        })
      );
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.className).toContain('fixed inset-0');
    expect(container.querySelector('button[aria-label="返回对话"]')).not.toBeNull();

    const text = container.textContent || '';
    for (const group of ['模型与对话', '通用与外观', '数据与关于']) {
      expect(text).toContain(group);
    }
    for (const item of [
      '模型供应商',
      '采样与上下文',
      '记忆库',
      '个性化与提示词',
      '通用与外观',
      '排版与进阶样式',
      '数据与同步',
      '关于与示例',
    ]) {
      expect(text).toContain(item);
    }
  });

  it('navigates into 采样与上下文 (10 keep-recent default) and 记忆库 cleanly on Desktop', () => {
    setViewportWidth(1280);

    function ControlledDesktopModal() {
      const [tab, setTab] = useState<SettingsTabKey>('generation');
      return createElement(SettingsModal, {
        open: true,
        activeTab: tab,
        onTabChange: setTab,
        onClose: vi.fn(),
      });
    }

    act(() => {
      root.render(createElement(ControlledDesktopModal));
    });

    expect(container.textContent).toContain('上下文统计与自动压缩');
    expect(container.textContent).toContain('10 条');
    expect(container.textContent).toContain('80%');
    const buttonTexts = Array.from(container.querySelectorAll('button')).map((b) =>
      b.textContent?.trim()
    );
    expect(buttonTexts).toContain('200K');
    expect(buttonTexts).toContain('500K');
    expect(buttonTexts).toContain('1M');
    expect(buttonTexts).not.toContain('32K');
    expect(buttonTexts).not.toContain('64K');
    expect(buttonTexts).not.toContain('128K');

    const memBtn = Array.from(container.querySelectorAll('nav button')).find((b) =>
      b.textContent?.includes('记忆库')
    ) as HTMLButtonElement | undefined;
    expect(memBtn).toBeDefined();

    act(() => {
      memBtn!.click();
    });

    expect(container.textContent).toContain('启用记忆库');
    expect(container.textContent).toContain('允许记录敏感信息');
    expect(container.textContent).toContain('单文件源码');
  });

  it('opens Level-1 menu on mobile when initialMobileRoot=true, drills into Level-2, and navigates back cleanly', () => {
    setViewportWidth(360);
    const onTabSpy = vi.fn();

    function ControlledModal() {
      const [tab, setTab] = useState<SettingsTabKey>('providers');
      return createElement(SettingsModal, {
        open: true,
        activeTab: tab,
        initialMobileRoot: true,
        onTabChange: (next: SettingsTabKey) => {
          onTabSpy(next);
          setTab(next);
        },
        onClose: vi.fn(),
      });
    }

    act(() => {
      root.render(createElement(ControlledModal));
    });

    // Level-1 mobile screen displays grouped categories & items without Level-2 detail back button
    expect(container.querySelector('button[aria-label="返回设置"]')).toBeNull();
    expect(container.textContent).toContain('排版与进阶样式');

    const typographyRow = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('排版与进阶样式')
    );
    expect(typographyRow).toBeDefined();

    act(() => {
      typographyRow!.click();
    });

    expect(onTabSpy).toHaveBeenCalledWith('typography');
    expect(container.querySelector('button[aria-label="返回设置"]')).not.toBeNull();
    expect(container.textContent).toContain('界面全局缩放');

    const backBtn = container.querySelector('button[aria-label="返回设置"]') as HTMLButtonElement;
    act(() => {
      backBtn.click();
    });

    expect(container.querySelector('button[aria-label="返回设置"]')).toBeNull();
    expect(container.textContent).toContain('模型与对话');
  });

  it('normalizes legacy "appearance" tab key seamlessly to 通用与外观 (general)', () => {
    setViewportWidth(1280);

    act(() => {
      root.render(
        createElement(SettingsModal, {
          open: true,
          activeTab: 'appearance',
          onTabChange: vi.fn(),
          onClose: vi.fn(),
        })
      );
    });

    const activeNavBtn = container.querySelector('button[aria-current="page"]');
    expect(activeNavBtn?.textContent).toContain('通用与外观');
    expect(container.textContent).toContain('外观主题与强调色');
  });

  it('PromptsTab collapses raw prompt textarea by default and opens secondary editor when clicking a preset row', () => {
    setViewportWidth(1280);

    act(() => {
      root.render(createElement(PromptsTab));
    });

    // Collapsed by default -> no large textareas visible until expanded or drilled into a preset
    expect(container.querySelectorAll('textarea').length).toBe(0);

    const togglePromptBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('编辑渲染增强协议正文')
    );
    expect(togglePromptBtn).toBeDefined();
    act(() => {
      togglePromptBtn!.click();
    });
    expect(container.querySelectorAll('textarea').length).toBe(1);

    const presetRow = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('标准学术导师')
    );
    expect(presetRow).toBeDefined();
    act(() => {
      presetRow!.click();
    });

    expect(container.textContent).toContain('返回预设列表');
    expect(container.textContent).toContain('系统提示词正文');
  });
});
