import React, { useState } from 'react';
import { ChevronRight, RotateCcw } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_APPEARANCE_SETTINGS, type ThemeMode } from '@/types/settings';
import { SmoothSlider } from '@/components/ui/SmoothSlider';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Collapsible } from '@/components/ui/MotionPrimitives';

const ACCENT_PRESETS = [
  { hex: '#d97757', label: '陶土暖橙' },
  { hex: '#ededed', label: '极简黑白' },
  { hex: '#6fb39c', label: '青瓷绿' },
  { hex: '#c9b18a', label: '暖沙金' },
  { hex: '#d4a94e', label: '暖麦金' },
  { hex: '#b87c96', label: '干枯玫瑰' },
];

const THEMES: Array<{ id: ThemeMode; name: string; desc: string }> = [
  { id: 'dark', name: '暖炭黑', desc: 'Claude 风格深邃暖灰' },
  { id: 'oled', name: 'OLED 纯黑', desc: 'AMOLED 纯黑省电' },
  { id: 'light', name: '暖纸白', desc: '柔和羊皮纸亮色' },
  { id: 'system', name: '跟随系统', desc: '自动切换深浅' },
];

export const AppearanceTab: React.FC = () => {
  const { appearance, updateAppearance } = useAppStore();
  const [customCssOpen, setCustomCssOpen] = useState(false);

  return (
    <div className="space-y-6 text-xs">
      {/* Theme Selection */}
      <div className="space-y-2">
        <div className="font-semibold text-fg">界面主题</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {THEMES.map((t) => {
            const active = appearance.theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => void updateAppearance({ theme: t.id })}
                className={`p-3 rounded-2xl border text-left active:scale-[0.98] transition ${
                  active
                    ? 'border-fg/40 bg-elevated text-fg'
                    : 'border-borderc bg-surface/50 text-muted hover:text-fg'
                }`}
              >
                <div className="font-semibold">{t.name}</div>
                <div className="text-[11px] opacity-80 mt-0.5">{t.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Accent Color */}
      <div className="space-y-2">
        <div className="font-semibold text-fg">强调色</div>
        <div className="flex flex-wrap items-center gap-2.5">
          {ACCENT_PRESETS.map(({ hex, label }) => {
            const active = appearance.accentColor.toLowerCase() === hex.toLowerCase();
            return (
              <button
                key={hex}
                type="button"
                onClick={() => void updateAppearance({ accentColor: hex })}
                style={{ backgroundColor: hex }}
                className={`w-7 h-7 rounded-full border-2 hover:scale-110 active:scale-95 transition ${
                  active
                    ? 'border-fg scale-110 shadow-md'
                    : 'border-borderc opacity-85 hover:opacity-100'
                }`}
                title={label}
                aria-label={label}
              />
            );
          })}
          <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-borderc bg-surface cursor-pointer">
            <span className="text-muted">自定义</span>
            <input
              type="color"
              value={appearance.accentColor}
              onChange={(e) => void updateAppearance({ accentColor: e.target.value })}
              className="w-5 h-5 bg-transparent border-0 cursor-pointer"
            />
          </label>
        </div>
      </div>

      {/* Typography & KaTeX Calibration */}
      <div className="rounded-2xl border border-borderc bg-surface/40 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-fg">阅读排版与公式校准</span>
          <button
            type="button"
            onClick={() => void updateAppearance(DEFAULT_APPEARANCE_SETTINGS)}
            className="flex items-center gap-1 text-muted hover:text-fg"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>恢复默认排版</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex justify-between text-muted">
              <span>正文字号</span>
              <span className="tabular-nums text-fg">{appearance.fontSize.toFixed(1)}px</span>
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

          <div className="space-y-1">
            <div className="flex justify-between text-muted">
              <span>公式相对缩放（KaTeX）</span>
              <span className="tabular-nums text-fg">{appearance.mathScale.toFixed(2)}x</span>
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

          <div className="space-y-1">
            <div className="flex justify-between text-muted">
              <span>行高</span>
              <span className="tabular-nums text-fg">{appearance.lineHeight.toFixed(2)}</span>
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

          <div className="space-y-1">
            <div className="flex justify-between text-muted">
              <span>正文栏最大宽度</span>
              <span className="tabular-nums text-fg">{appearance.contentMaxWidth}px</span>
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

          <label className="space-y-1">
            <span className="text-muted">正文字体风格</span>
            <select
              value={appearance.fontFamily}
              onChange={(e) =>
                void updateAppearance({
                  fontFamily: e.target.value as 'system' | 'serif' | 'mono' | 'custom',
                })
              }
              className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg"
            >
              <option value="system">现代无衬线（Inter + 系统中文）</option>
              <option value="serif">社论衬线体（Newsreader + 学术中文）</option>
              <option value="mono">等宽代码体（JetBrains Mono）</option>
              <option value="custom">自定义字体名称</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-muted">代码高亮主题</span>
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
              className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg"
            >
              <option value="auto">跟随界面主题自动匹配</option>
              <option value="github-dark-default">GitHub Dark Default</option>
              <option value="vitesse-black">Vitesse Black</option>
              <option value="github-light">GitHub Light</option>
            </select>
          </label>
        </div>

        {appearance.fontFamily === 'custom' && (
          <label className="block space-y-1">
            <span className="text-muted">自定义字体族名称</span>
            <input
              value={appearance.customFontName}
              onChange={(e) => void updateAppearance({ customFontName: e.target.value })}
              placeholder="例如: 'LXGW WenKai', 'Inter', sans-serif"
              className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg font-mono"
            />
          </label>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-bg/70 border border-borderc">
            <span>代码块显示行号</span>
            <ToggleSwitch
              checked={appearance.showLineNumbers}
              onChange={(checked) => void updateAppearance({ showLineNumbers: checked })}
              ariaLabel="代码块显示行号"
            />
          </div>

          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-bg/70 border border-borderc">
            <span>自动渲染交互网页块</span>
            <ToggleSwitch
              checked={appearance.autoPreviewArtifacts}
              onChange={(checked) => void updateAppearance({ autoPreviewArtifacts: checked })}
              ariaLabel="自动渲染交互网页块"
            />
          </div>

          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-bg/70 border border-borderc">
            <span>Enter 直接发送</span>
            <ToggleSwitch
              checked={appearance.sendOnEnter}
              onChange={(checked) => void updateAppearance({ sendOnEnter: checked })}
              ariaLabel="Enter 直接发送"
            />
          </div>
        </div>
      </div>

      {/* Smooth Collapsible Custom CSS Injection */}
      <div className="rounded-2xl border border-borderc bg-surface/40 overflow-hidden">
        <button
          type="button"
          onClick={() => setCustomCssOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3.5 text-left font-semibold text-fg hover:bg-fg/[0.03] transition"
        >
          <span>进阶自定义：全局自定义 CSS 注入</span>
          <ChevronRight
            className={`w-4 h-4 text-muted transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              customCssOpen ? 'rotate-90 text-fg' : ''
            }`}
          />
        </button>
        <Collapsible open={customCssOpen}>
          <div className="px-4 pb-4 pt-1 border-t border-borderc">
            <p className="text-muted mt-1.5 mb-2">
              可覆盖任意页面变量（如 <code>--bg</code>、<code>--accent</code>）或{' '}
              <code>.cb-markdown</code>、<code>.katex</code> 样式，实时生效。
            </p>
            <textarea
              rows={5}
              value={appearance.customCss}
              onChange={(e) => void updateAppearance({ customCss: e.target.value })}
              placeholder={`/* 示例：\n.cb-markdown .katex-display { background: rgba(255,255,255,0.03); border-radius: 12px; }\n*/`}
              className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc font-mono text-xs text-fg focus:outline-none focus:border-fg/40"
            />
          </div>
        </Collapsible>
      </div>
    </div>
  );
};
