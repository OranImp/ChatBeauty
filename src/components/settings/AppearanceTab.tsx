import React from 'react';
import { RotateCcw } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_APPEARANCE_SETTINGS, type ThemeMode } from '@/types/settings';

const ACCENT_PRESETS = ['#38bdf8', '#34d399', '#a3e635', '#a78bfa', '#f59e0b', '#fb7185'];

const THEMES: Array<{ id: ThemeMode; name: string; desc: string }> = [
  { id: 'oled', name: 'OLED 纯黑', desc: '深邃护眼极简黑' },
  { id: 'dark', name: '柔和深灰', desc: '中性石墨暗色' },
  { id: 'light', name: '极简亮色', desc: '纸张质感白底' },
  { id: 'system', name: '跟随系统', desc: '自动切换深浅' },
];

export const AppearanceTab: React.FC = () => {
  const { appearance, updateAppearance } = useAppStore();

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
                className={`p-3 rounded-2xl border text-left transition ${
                  active
                    ? 'border-accent bg-accent/10 text-fg'
                    : 'border-borderc bg-surface/60 text-muted hover:text-fg'
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
          {ACCENT_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => void updateAppearance({ accentColor: color })}
              style={{ backgroundColor: color }}
              className={`w-7 h-7 rounded-full border-2 transition ${
                appearance.accentColor.toLowerCase() === color.toLowerCase()
                  ? 'border-white scale-110 shadow-md'
                  : 'border-transparent opacity-80 hover:opacity-100'
              }`}
              aria-label={color}
            />
          ))}
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
          <label className="space-y-1">
            <div className="flex justify-between text-muted">
              <span>正文字号</span>
              <span className="tabular-nums text-fg">{appearance.fontSize}px</span>
            </div>
            <input
              type="range"
              min="13"
              max="22"
              step="1"
              value={appearance.fontSize}
              onChange={(e) => void updateAppearance({ fontSize: parseInt(e.target.value, 10) })}
              className="w-full accent-sky-400"
            />
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-muted">
              <span>公式相对缩放（KaTeX）</span>
              <span className="tabular-nums text-fg">{appearance.mathScale.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.85"
              max="1.35"
              step="0.02"
              value={appearance.mathScale}
              onChange={(e) => void updateAppearance({ mathScale: parseFloat(e.target.value) })}
              className="w-full accent-sky-400"
            />
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-muted">
              <span>行高</span>
              <span className="tabular-nums text-fg">{appearance.lineHeight.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="1.4"
              max="2.1"
              step="0.04"
              value={appearance.lineHeight}
              onChange={(e) => void updateAppearance({ lineHeight: parseFloat(e.target.value) })}
              className="w-full accent-sky-400"
            />
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-muted">
              <span>正文栏最大宽度</span>
              <span className="tabular-nums text-fg">{appearance.contentMaxWidth}px</span>
            </div>
            <input
              type="range"
              min="600"
              max="1120"
              step="20"
              value={appearance.contentMaxWidth}
              onChange={(e) =>
                void updateAppearance({ contentMaxWidth: parseInt(e.target.value, 10) })
              }
              className="w-full accent-sky-400"
            />
          </label>

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
              <option value="system">现代无衬线（系统默认）</option>
              <option value="serif">学术衬线体（论文风）</option>
              <option value="mono">等宽极客风</option>
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
          <label className="flex items-center justify-between px-3 py-2 rounded-xl bg-bg/70 border border-borderc cursor-pointer">
            <span>代码块显示行号</span>
            <input
              type="checkbox"
              checked={appearance.showLineNumbers}
              onChange={(e) => void updateAppearance({ showLineNumbers: e.target.checked })}
              className="accent-sky-400"
            />
          </label>

          <label className="flex items-center justify-between px-3 py-2 rounded-xl bg-bg/70 border border-borderc cursor-pointer">
            <span>自动渲染交互网页块</span>
            <input
              type="checkbox"
              checked={appearance.autoPreviewArtifacts}
              onChange={(e) => void updateAppearance({ autoPreviewArtifacts: e.target.checked })}
              className="accent-sky-400"
            />
          </label>

          <label className="flex items-center justify-between px-3 py-2 rounded-xl bg-bg/70 border border-borderc cursor-pointer">
            <span>Enter 直接发送</span>
            <input
              type="checkbox"
              checked={appearance.sendOnEnter}
              onChange={(e) => void updateAppearance({ sendOnEnter: e.target.checked })}
              className="accent-sky-400"
            />
          </label>
        </div>
      </div>

      {/* Custom CSS Injection */}
      <details className="rounded-2xl border border-borderc bg-surface/40 p-4">
        <summary className="cursor-pointer font-semibold text-fg">
          进阶自定义：全局自定义 CSS 注入
        </summary>
        <p className="text-muted mt-1.5 mb-2">
          可覆盖任意页面变量（如 <code>--bg</code>、<code>--accent</code>）或 <code>.cb-markdown</code>、<code>.katex</code> 样式，实时生效。
        </p>
        <textarea
          rows={5}
          value={appearance.customCss}
          onChange={(e) => void updateAppearance({ customCss: e.target.value })}
          placeholder={`/* 示例：\n.cb-markdown .katex-display { background: rgba(255,255,255,0.03); border-radius: 12px; }\n*/`}
          className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc font-mono text-xs text-fg focus:outline-none focus:border-accent"
        />
      </details>
    </div>
  );
};
