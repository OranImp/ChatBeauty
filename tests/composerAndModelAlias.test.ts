// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation, ModelDefinition, ProviderConfig } from '@/types/chat';
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_CONTEXT_SETTINGS,
  DEFAULT_GENERATION_SETTINGS,
  DEFAULT_MEMORY_SETTINGS,
} from '@/types/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeProviders(): ProviderConfig[] {
  return [
    {
      id: 'prov-1',
      name: '主线 OpenAI',
      protocol: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-1',
      defaultModel: 'gpt-6.2-sol',
      models: [
        { id: 'gpt-6.2-sol', name: 'Sol 主力', capabilities: { chat: true, vision: true } },
        { id: 'gpt-6-luna', name: 'gpt-6-luna', capabilities: { chat: true } },
      ],
      enabled: true,
      createdAt: 1,
    },
    {
      id: 'prov-2',
      name: '备用 Gemini',
      protocol: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'AIza-2',
      defaultModel: 'gemini-4-neon',
      models: [{ id: 'gemini-4-neon', name: 'Gemini 4 推理', capabilities: { chat: true } }],
      enabled: true,
      createdAt: 2,
    },
    {
      id: 'prov-3',
      name: '备用 Claude',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant-3',
      defaultModel: 'claude-sonnet-4-6',
      models: [{ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', capabilities: { chat: true } }],
      enabled: true,
      createdAt: 3,
    },
  ];
}

const mockFetchModels = vi.fn<() => Promise<ModelDefinition[]>>(async () => []);
const mockSaveProvider = vi.fn<(p: ProviderConfig) => Promise<void>>(async () => undefined);

const mockStore = {
  appearance: DEFAULT_APPEARANCE_SETTINGS,
  conversations: [
    {
      id: 'conv-1',
      title: '测试会话',
      createdAt: 1,
      updatedAt: 1,
      providerId: 'prov-1',
      modelId: 'gpt-6.2-sol',
    } satisfies Conversation,
  ],
  messagesByConv: { 'conv-1': [] },
  activeConversationId: 'conv-1',
  providers: makeProviders(),
  activeProviderId: 'prov-1',
  activeModelId: 'gpt-6.2-sol',
  generation: DEFAULT_GENERATION_SETTINGS,
  contextSettings: DEFAULT_CONTEXT_SETTINGS,
  memorySettings: DEFAULT_MEMORY_SETTINGS,
  memoryEntries: [],
  compactingByConv: {},
  promptPresets: [
    {
      id: 'preset_default',
      name: '标准学术导师',
      description: 'desc',
      content: 'sys',
      isBuiltIn: true,
      category: 'academic' as const,
      updatedAt: 1,
    },
  ],
  promptSettings: {
    defaultPresetId: 'preset_default',
    renderEnhancementEnabled: true,
    renderEnhancementPrompt: 'enhance',
  },
  modelProfileSync: {
    remoteUrl: '',
    remoteRules: [],
    customRules: [],
  },
  updateConversationConfig: vi.fn(async () => undefined),
  setActiveProviderModel: vi.fn(async () => undefined),
  updateGeneration: vi.fn(async () => undefined),
  updateContextSettings: vi.fn(async () => undefined),
  updateModelProfileSync: vi.fn(async () => undefined),
  syncRemoteModelProfiles: vi.fn(async () => ({ ok: true, message: 'ok', count: 0 })),
  saveCustomModelProfileRules: vi.fn(async () => undefined),
  compactConversation: vi.fn(async () => ({ ok: true, message: 'ok' })),
  saveProvider: mockSaveProvider,
  deleteProvider: vi.fn(async () => undefined),
  fetchProviderModels: mockFetchModels,
  testProviderConnection: vi.fn(async () => 'ok'),
};

vi.mock('@/store/useAppStore', () => ({
  resolveValidProviderAndModel: (
    conv: Conversation | undefined,
    providers: ProviderConfig[],
    activeProviderId: string | null,
    activeModelId: string | null
  ) => {
    const provider =
      providers.find((p) => p.id === (conv?.providerId || activeProviderId)) ?? providers[0];
    const modelId = conv?.modelId || activeModelId || provider?.defaultModel || '';
    return { provider, modelId };
  },
  useAppStore: (selector?: (s: typeof mockStore) => unknown) =>
    selector ? selector(mockStore) : mockStore,
}));

vi.mock('@/services/transport/streamHttp', () => ({
  subscribeDesktopClipboardImagePaste: () => () => undefined,
  getRuntimeEnvironment: () => 'web',
  getAndroidBatteryStatus: vi.fn(async () => ({ ignoring: false, supported: false })),
  openAndroidBatterySettings: vi.fn(async () => false),
}));

import { ChatInput } from '@/components/chat/ChatInput';
import { ProvidersTab } from '@/components/settings/ProvidersTab';

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Composer UX & custom model display names', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockStore.providers = makeProviders();
    mockFetchModels.mockReset();
    mockSaveProvider.mockReset();
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

  it('merges image upload into + menu, removes extraBody from params popover, supports collapsible providers, and shows model alias vs ID', async () => {
    act(() => {
      root.render(
        createElement(ChatInput, {
          onSend: vi.fn(),
          onStop: vi.fn(),
          isStreaming: false,
          onOpenSettings: vi.fn(),
        })
      );
    });

    // 1. Standalone toolbar upload button is removed
    expect(container.querySelector('button[aria-label="上传图片"]')).toBeNull();

    // 2. Composer model pill displays custom display name instead of raw ID
    const modelBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Sol 主力')
    );
    expect(modelBtn).toBeDefined();

    // 3. Plus menu contains image upload entry
    const plusBtn = container.querySelector('button[aria-label="更多能力、提示词与上传图片"]') as HTMLButtonElement;
    expect(plusBtn).not.toBeNull();
    act(() => {
      plusBtn.click();
    });
    expect(container.textContent).toContain('上传图片（识图）');

    // Close + menu and verify params popover excludes extraBody JSON editor
    act(() => {
      plusBtn.click();
    });
    const paramsBtn = container.querySelector('button[aria-label="自定义模型参数"]') as HTMLButtonElement;
    expect(paramsBtn).not.toBeNull();
    act(() => {
      paramsBtn.click();
    });
    expect(container.textContent).toContain('当前会话参数覆盖');
    expect(container.textContent).not.toContain('extraBody');
    expect(container.textContent).not.toContain('自定义请求体');

    // Close params popover, open model selector and verify collapsible provider groups + alias & ID distinction
    act(() => {
      paramsBtn.click();
    });
    act(() => {
      modelBtn!.click();
    });

    // Since prov-1 is expanded while prov-2 & prov-3 are collapsed, toggle shows 全部折叠
    expect(container.textContent).toContain('全部折叠');
    const toggleAllBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.trim() === '全部折叠'
    ) as HTMLButtonElement;
    expect(toggleAllBtn).toBeDefined();

    const provider1Header = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('主线 OpenAI')
    ) as HTMLButtonElement;
    const provider2Header = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('备用 Gemini')
    ) as HTMLButtonElement;

    // >2 providers: active provider starts expanded, non-active providers start collapsed
    expect(provider1Header.getAttribute('aria-expanded')).toBe('true');
    expect(provider2Header.getAttribute('aria-expanded')).toBe('false');
    // Both alias and underlying ID are rendered cleanly for aliased models
    expect(container.textContent).toContain('Sol 主力');
    expect(container.textContent).toContain('gpt-6.2-sol');

    // Clicking 全部折叠 collapses all and switches button to 全部展开
    act(() => {
      toggleAllBtn.click();
    });
    expect(provider1Header.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).toContain('全部展开');

    // Clicking collapsed provider header expands it cleanly
    act(() => {
      provider2Header.click();
    });
    expect(provider2Header.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Gemini 4 推理');
    expect(container.textContent).toContain('gemini-4-neon');
  });

  it('edits custom model display name separately from model ID and preserves it across fetchProviderModels', async () => {
    act(() => {
      root.render(createElement(ProvidersTab, { section: 'providers' }));
    });

    // Open editor for prov-1
    const editButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === '编辑'
    ) as HTMLButtonElement[];
    expect(editButtons.length).toBeGreaterThan(0);
    act(() => {
      editButtons[0].click();
    });

    // Expand per-model settings for gpt-6.2-sol
    const expandModelBtns = Array.from(
      container.querySelectorAll('button[title="自定义该模型参数与思考强度系列"]')
    ) as HTMLButtonElement[];
    expect(expandModelBtns.length).toBeGreaterThan(0);
    act(() => {
      expandModelBtns[0].click();
    });

    expect(container.textContent).toContain('模型 ID（API 请求用）');
    const aliasInput = container.querySelector(
      'input[aria-label="自定义显示名称 gpt-6.2-sol"]'
    ) as HTMLInputElement;
    expect(aliasInput).not.toBeNull();
    expect(aliasInput.value).toBe('Sol 主力');

    act(() => {
      setInputValue(aliasInput, '定制中文别名');
    });

    // Save config and ensure custom name is saved while real ID remains untouched
    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('保存配置')
    ) as HTMLButtonElement;
    await act(async () => {
      saveBtn.click();
      await Promise.resolve();
    });

    expect(mockSaveProvider).toHaveBeenCalled();
    const savedArg = mockSaveProvider.mock.calls[0][0];
    expect(savedArg.models[0].id).toBe('gpt-6.2-sol');
    expect(savedArg.models[0].name).toBe('定制中文别名');

    // Re-fetching online models preserves user's custom display name
    mockFetchModels.mockResolvedValueOnce([
      { id: 'gpt-6.2-sol', name: 'gpt-6.2-sol', capabilities: { chat: true } },
      { id: 'gpt-6.5-new', name: 'gpt-6.5-new', capabilities: { chat: true } },
    ]);
    const fetchBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('在线拉取模型')
    ) as HTMLButtonElement;
    await act(async () => {
      fetchBtn.click();
      await Promise.resolve();
    });

    const fetchedSaved = mockSaveProvider.mock.calls[mockSaveProvider.mock.calls.length - 1][0];
    expect(fetchedSaved.models.find((m) => m.id === 'gpt-6.2-sol')?.name).toBe('定制中文别名');
    expect(fetchedSaved.models.find((m) => m.id === 'gpt-6.5-new')?.name).toBe('gpt-6.5-new');
  });
});
