import React, { useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import {
  BatteryCharging,
  Code2,
  CornerDownLeft,
  Frame,
  ListOrdered,
  Monitor,
  Palette,
  RotateCcw,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import {
  getAndroidBatteryStatus,
  getRuntimeEnvironment,
  openAndroidBatterySettings,
} from '@/services/transport/streamHttp';
import { DEFAULT_APPEARANCE_SETTINGS, type ThemeMode } from '@/types/settings';
import { SmoothSlider } from '@/components/ui/SmoothSlider';
import {
  SettingsCollapsibleRow,
  SettingsRow,
  SettingsSection,
  SettingsToggleRow,
} from './SettingsPrimitives';

interface AppearanceTabProps {
  section?: 'general' | 'typography';
}

const ACCENT_PRESETS = [
  { hex: '#d97757', label: '陶土暖橙' },
  { hex: '#ededed', label: '极简黑白' },
  { hex: '#6fb39c', label: '青瓷绿' },
  { hex: '#c9b18a', label: '暖沙金' },
  { hex: '#d4a94e', label: '暖麦金' },
  { hex: '#b87c96', label: '干枯玫瑰' },
];

export const THEME_OPTIONS: Array<{ id: ThemeMode; name: string; desc: string }> = [
  { id: 'dark', name: '暖炭黑', desc: '深邃暖灰' },
  { id: 'oled', name: 'OLED 纯黑', desc: '纯黑省电' },
  { id: 'light', name: '暖纸白', desc: '羊皮纸亮色' },
  { id: 'system', name: '跟随系统', desc: '自动切换' },
];

const UI_SCALE_PRESETS = [
  { label: '紧凑 95%', value: 0.95 },
  { label: '舒适 106% (默认)', value: 1.06 },
  { label: '大号 116%', value: 1.16 },
  { label: '超大 126%', value: 1.26 },
];

export const AppearanceTab: React.FC<AppearanceTabProps> = ({ section = 'general' }) => {
  const { appearance, updateAppearance } = useAppStore();
  const [customCssOpen, setCustomCssOpen] = useState(false);
  const runtimeEnv = getRuntimeEnvironment();
  const [batteryIgnored, setBatteryIgnored] = useState<boolean | null>(null);
  const [batteryChecking, setBatteryChecking] = useState(false);

  const refreshBatteryStatus = async () => {
    if (runtimeEnv !== 'capacitor') return;
    setBatteryChecking(true);
    try {
      const status = await getAndroidBatteryStatus();
      setBatteryIgnored(Boolean(status?.ignoring));
    } catch {
      // Ignore probe error on unsupported runtime
    } finally {
      setBatteryChecking(false);
    }
  };

  useEffect(() => {
    if (section !== 'general' || runtimeEnv !== 'capacitor') return;
    let cancelled = false;
    const syncBattery = async () => {
      setBatteryChecking(true);
      try {
        const status = await getAndroidBatteryStatus();
        if (!cancelled) {
          setBatteryIgnored(Boolean(status?.ignoring));
        }
      } catch {
        // Ignore probe error on unsupported runtime
      } finally {
        if (!cancelled) {
          setBatteryChecking(false);
        }
      }
    };
    void syncBattery();

    let handlePromise: Promise<{ remove: () => Promise<void> }> | null = null;
    try {
      handlePromise = CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void syncBattery();
      });
    } catch {
      // Ignore outside Capacitor native shell
    }

    return () => {
      cancelled = true;
      if (handlePromise) {
        void handlePromise.then((h) => h.remove()).catch(() => undefined);
      }
    };
  }, [runtimeEnv, section]);

  if (section === 'typography') {
    return (
      <div className="space-y-5 text-[13.5px] min-w-0 max-w-full">
        <SettingsSection title="界面全局缩放">
          <div className="px-3.5 sm:px-4 py-3.5 space-y-3 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-fg">界面文字与图标缩放</span>
              <span className="font-mono text-xs tabular-nums text-fg">
                {Math.round((appearance.uiScale ?? 1.06) * 100)}% (
                {(appearance.uiScale ?? 1.06).toFixed(2)}x)
              </span>
            </div>
            <SmoothSlider
              min={0.9}
              max={1.35}
              decimals={2}
              value={appearance.uiScale ?? 1.06}
              onChange={(val) => void updateAppearance({ uiScale: val })}
              ariaLabel="界面与图标全局缩放"
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 min-w-0">
              {UI_SCALE_PRESETS.map((preset) => {
                const active = Math.abs((appearance.uiScale ?? 1.06) - preset.value) < 0.015;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => void updateAppearance({ uiScale: preset.value })}
                    className={`px-2.5 py-1.5 rounded-xl border text-xs text-center truncate active:scale-95 transition ${
                      active
                        ? 'border-accent bg-accent text-accentfg font-semibold'
                        : 'border-borderc bg-bg/70 text-muted hover:text-fg'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title="阅读排版与公式校准"
          action={
            <button
              type="button"
              onClick={() =>
                void updateAppearance({
                  uiScale: DEFAULT_APPEARANCE_SETTINGS.uiScale,
                  fontSize: DEFAULT_APPEARANCE_SETTINGS.fontSize,
                  mathScale: DEFAULT_APPEARANCE_SETTINGS.mathScale,
                  lineHeight: DEFAULT_APPEARANCE_SETTINGS.lineHeight,
                  contentMaxWidth: DEFAULT_APPEARANCE_SETTINGS.contentMaxWidth,
                  fontFamily: DEFAULT_APPEARANCE_SETTINGS.fontFamily,
                  customFontName: DEFAULT_APPEARANCE_SETTINGS.customFontName,
                  codeTheme: DEFAULT_APPEARANCE_SETTINGS.codeTheme,
                })
              }
              className="flex items-center gap-1 text-xs text-muted hover:text-fg transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>恢复默认排版</span>
            </button>
          }
        >
          <div className="px-3.5 sm:px-4 py-3.5 grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
            <div className="space-y-1.5 min-w-0">
              <div className="flex justify-between text-xs text-muted">
                <span>正文字号</span>
                <span className="font-mono tabular-nums text-fg">
                  {appearance.fontSize.toFixed(1)}px
                </span>
              </div>
              <SmoothSlider
                min={13}
                max={22}
                decimals={1}
                value={appearance.fontSize}
                onChange={(val) => void updateAppearance({ fontSize: val })}
                ariaLabel="正文字号"
              />
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="flex justify-between text-xs text-muted">
                <span>公式相对缩放（KaTeX）</span>
                <span className="font-mono tabular-nums text-fg">
                  {appearance.mathScale.toFixed(2)}x
                </span>
              </div>
              <SmoothSlider
                min={0.85}
                max={1.35}
                decimals={2}
                value={appearance.mathScale}
                onChange={(val) => void updateAppearance({ mathScale: val })}
                ariaLabel="公式相对缩放"
              />
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="flex justify-between text-xs text-muted">
                <span>行高</span>
                <span className="font-mono tabular-nums text-fg">
                  {appearance.lineHeight.toFixed(2)}
                </span>
              </div>
              <SmoothSlider
                min={1.4}
                max={2.1}
                decimals={2}
                value={appearance.lineHeight}
                onChange={(val) => void updateAppearance({ lineHeight: val })}
                ariaLabel="行高"
              />
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="flex justify-between text-xs text-muted">
                <span>正文栏最大宽度</span>
                <span className="font-mono tabular-nums text-fg">
                  {appearance.contentMaxWidth}px
                </span>
              </div>
              <SmoothSlider
                min={600}
                max={1120}
                decimals={0}
                value={appearance.contentMaxWidth}
                onChange={(val) => void updateAppearance({ contentMaxWidth: val })}
                ariaLabel="正文栏最大宽度"
              />
            </div>
          </div>

          <SettingsRow
            title="正文字体风格"
            description="影响消息正文与数学公式周围文字衬线"
            trailing={
              <select
                value={appearance.fontFamily}
                onChange={(e) =>
                  void updateAppearance({
                    fontFamily: e.target.value as 'system' | 'serif' | 'mono' | 'custom',
                  })
                }
                aria-label="正文字体风格"
                className="w-full sm:w-56 px-3 py-1.5 rounded-xl bg-bg border border-borderc text-xs text-fg focus:outline-none focus:border-fg/40"
              >
                <option value="system">现代无衬线（Inter + 系统中文）</option>
                <option value="serif">社论衬线体（Newsreader + 学术中文）</option>
                <option value="mono">等宽代码体（JetBrains Mono）</option>
                <option value="custom">自定义字体名称</option>
              </select>
            }
          />

          {appearance.fontFamily === 'custom' && (
            <SettingsRow
              title="自定义字体族名称"
              trailing={
                <input
                  value={appearance.customFontName}
                  onChange={(e) => void updateAppearance({ customFontName: e.target.value })}
                  placeholder="例如: 'LXGW WenKai', sans-serif"
                  className="w-full sm:w-56 px-3 py-1.5 rounded-xl bg-bg border border-borderc text-xs font-mono text-fg focus:outline-none focus:border-fg/40"
                />
              }
            />
          )}

          <SettingsRow
            title="代码高亮主题"
            description="决定 Markdown 代码块语法着色方案"
            trailing={
              <select
                value={appearance.codeTheme}
                onChange={(e) =>
                  void updateAppearance({
                    codeTheme: e.target.value as
                      | 'auto'
                      | 'github-dark-default'
                      | 'vitesse-black'
                      | 'github-light',
                  })
                }
                aria-label="代码高亮主题"
                className="w-full sm:w-56 px-3 py-1.5 rounded-xl bg-bg border border-borderc text-xs text-fg focus:outline-none focus:border-fg/40"
              >
                <option value="auto">跟随界面主题自动匹配</option>
                <option value="github-dark-default">GitHub Dark Default</option>
                <option value="vitesse-black">Vitesse Black</option>
                <option value="github-light">GitHub Light</option>
              </select>
            }
          />
        </SettingsSection>

        <SettingsSection title="进阶样式">
          <SettingsCollapsibleRow
            icon={<Code2 className="w-4 h-4" />}
            title="全局自定义 CSS 注入"
            description="覆盖页面 CSS 变量或 Markdown / KaTeX 样式，实时生效"
            value={appearance.customCss.trim() ? '已自定义' : '未配置'}
            open={customCssOpen}
            onToggle={() => setCustomCssOpen((v) => !v)}
          >
            <textarea
              rows={5}
              value={appearance.customCss}
              onChange={(e) => void updateAppearance({ customCss: e.target.value })}
              placeholder={`/* 示例：\n.cb-markdown .katex-display { background: rgba(255,255,255,0.03); border-radius: 12px; }\n*/`}
              className="w-full min-w-0 px-3 py-2 rounded-xl bg-bg border border-borderc font-mono text-xs text-fg focus:outline-none focus:border-fg/40"
            />
          </SettingsCollapsibleRow>
        </SettingsSection>
      </div>
    );
  }

  return (
    <div className="space-y-5 text-[13.5px] min-w-0 max-w-full">
      <SettingsSection title="外观主题与强调色">
        <div className="px-3.5 sm:px-4 py-3.5 space-y-2.5 min-w-0">
          <div className="text-[13.5px] font-medium text-fg">界面主题</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-0">
            {THEME_OPTIONS.map((t) => {
              const active = appearance.theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void updateAppearance({ theme: t.id })}
                  className={`p-3 rounded-xl border text-left active:scale-[0.98] transition ${
                    active
                      ? 'border-accent bg-elevated text-fg'
                      : 'border-borderc bg-bg/60 text-muted hover:text-fg hover:bg-bg'
                  }`}
                >
                  <div className="font-semibold text-[13px] truncate">{t.name}</div>
                  <div className="text-[11px] opacity-80 mt-0.5 truncate">{t.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        <SettingsRow
          icon={<Palette className="w-4 h-4" />}
          title="强调色"
          description="主按钮、高亮标签与激活指示条颜色"
          trailing={
            <div className="flex flex-wrap items-center gap-2">
              {ACCENT_PRESETS.map(({ hex, label }) => {
                const active = appearance.accentColor.toLowerCase() === hex.toLowerCase();
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => void updateAppearance({ accentColor: hex })}
                    style={{ backgroundColor: hex }}
                    className={`w-6 h-6 rounded-full border-2 hover:scale-110 active:scale-95 transition ${
                      active
                        ? 'border-fg scale-110 shadow-md'
                        : 'border-borderc opacity-85 hover:opacity-100'
                    }`}
                    title={label}
                    aria-label={label}
                  />
                );
              })}
              <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-borderc bg-bg cursor-pointer">
                <span className="text-xs text-muted">自定义</span>
                <input
                  type="color"
                  value={appearance.accentColor}
                  onChange={(e) => void updateAppearance({ accentColor: e.target.value })}
                  className="w-4 h-4 bg-transparent border-0 cursor-pointer"
                />
              </label>
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection title="交互与渲染显示">
        <SettingsToggleRow
          icon={<CornerDownLeft className="w-4 h-4" />}
          title="Enter 直接发送"
          description="开启后按 Enter 键立即发送，Shift+Enter 换行"
          checked={appearance.sendOnEnter}
          onChange={(checked) => void updateAppearance({ sendOnEnter: checked })}
          ariaLabel="Enter 直接发送"
        />
        <SettingsToggleRow
          icon={<Frame className="w-4 h-4" />}
          title="隐藏图表与图片外框"
          description="隐藏 SVG / Mermaid / ECharts / 图片边框与顶栏"
          checked={Boolean(appearance.hideMediaFrames)}
          onChange={(checked) => void updateAppearance({ hideMediaFrames: checked })}
          ariaLabel="隐藏图表与图片外框"
        />
        <SettingsToggleRow
          icon={<ListOrdered className="w-4 h-4" />}
          title="代码块显示行号"
          description="在语法高亮代码块左侧展示行号"
          checked={appearance.showLineNumbers}
          onChange={(checked) => void updateAppearance({ showLineNumbers: checked })}
          ariaLabel="代码块显示行号"
        />
        <SettingsToggleRow
          icon={<Sparkles className="w-4 h-4" />}
          title="自动渲染交互网页块"
          description="生成完成后自动展开 HTML 交互演示沙盒"
          checked={appearance.autoPreviewArtifacts}
          onChange={(checked) => void updateAppearance({ autoPreviewArtifacts: checked })}
          ariaLabel="自动渲染交互网页块"
        />
      </SettingsSection>

      {(runtimeEnv === 'electron' || runtimeEnv === 'capacitor') && (
        <SettingsSection
          title={runtimeEnv === 'electron' ? '后台生成与托盘设置' : '后台生成与保活设置'}
        >
          <SettingsToggleRow
            icon={
              runtimeEnv === 'electron' ? (
                <Monitor className="w-4 h-4 text-accent" />
              ) : (
                <Smartphone className="w-4 h-4 text-accent" />
              )
            }
            title="启用后台持续生成"
            description={
              runtimeEnv === 'electron'
                ? '最小化或隐藏至托盘时不中断流式输出，完成后发送系统通知'
                : '切换应用或息屏时不中断流式输出，由前台服务持续保活'
            }
            checked={appearance.backgroundGeneration ?? true}
            onChange={(checked) => void updateAppearance({ backgroundGeneration: checked })}
            ariaLabel="启用后台持续生成"
          />

          {runtimeEnv === 'electron' && (
            <SettingsToggleRow
              icon={<Monitor className="w-4 h-4" />}
              title="关闭窗口最小化到托盘"
              description="点击主窗口关闭按钮后隐藏至右下角系统托盘并在后台继续运行"
              checked={appearance.closeToTray ?? true}
              onChange={(checked) => void updateAppearance({ closeToTray: checked })}
              ariaLabel="关闭窗口最小化到托盘"
            />
          )}

          {runtimeEnv === 'capacitor' && (
            <SettingsRow
              icon={<BatteryCharging className="w-4 h-4 text-muted" />}
              title="手机端后台保活（无限制电池策略）"
              description={
                batteryIgnored === true
                  ? '当前已授予「电池无限制」，后台生成时会自动启用前台服务与唤醒锁'
                  : '建议在系统设置中将 ChatBeauty 设为「后台无限制 / 忽略电池优化」，防止息屏断流'
              }
              trailing={
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void refreshBatteryStatus()}
                    disabled={batteryChecking}
                    className="px-2.5 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-muted hover:text-fg transition disabled:opacity-50"
                  >
                    {batteryChecking ? '检测中...' : '刷新状态'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void openAndroidBatterySettings().then(() => {
                        setTimeout(() => void refreshBatteryStatus(), 800);
                      });
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-accentfg text-xs font-semibold transition"
                  >
                    <BatteryCharging className="w-4 h-4" />
                    <span>{batteryIgnored ? '查看电池策略' : '去设置后台无限制'}</span>
                  </button>
                </div>
              }
            />
          )}
        </SettingsSection>
      )}
    </div>
  );
};
