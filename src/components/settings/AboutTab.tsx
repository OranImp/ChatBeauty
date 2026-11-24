import React from 'react';
import { Code2, Database, FileText, Info, Sparkles } from 'lucide-react';
import { SettingsRow, SettingsSection } from './SettingsPrimitives';

interface AboutTabProps {
  onOpenDemo: () => void;
}

export const AboutTab: React.FC<AboutTabProps> = ({ onOpenDemo }) => {
  return (
    <div className="space-y-5 text-[13.5px] min-w-0 max-w-full">
      <SettingsSection title="交互与渲染演示">
        <SettingsRow
          icon={<Sparkles className="w-4 h-4 text-accent" />}
          title="渲染效果示例"
          description="打开内置演示会话，预览 LaTeX 公式、SVG 电路图、Mermaid 流程图、ECharts 图表与交互沙盒"
          trailing={
            <button
              type="button"
              onClick={onOpenDemo}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-accentfg text-xs font-semibold hover:opacity-90 active:scale-95 transition"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>打开示例</span>
            </button>
          }
        />
      </SettingsSection>

      <SettingsSection title="关于 ChatBeauty">
        <SettingsRow
          icon={<Info className="w-4 h-4" />}
          title="当前版本"
          trailing={<span className="font-mono text-xs text-muted">v0.5.2</span>}
        />
        <SettingsRow
          icon={<FileText className="w-4 h-4" />}
          title="开源协议"
          trailing={<span className="font-mono text-xs text-muted">MIT License</span>}
        />
        <SettingsRow
          icon={<Code2 className="w-4 h-4" />}
          title="内嵌字体"
          trailing={
            <span className="font-mono text-xs text-muted text-right break-all">
              Inter / Newsreader / JetBrains Mono (SIL OFL)
            </span>
          }
        />
        <SettingsRow
          icon={<Database className="w-4 h-4" />}
          title="数据存储"
          trailing={<span className="text-xs text-muted">本地 IndexedDB（离线优先）</span>}
        />
      </SettingsSection>
    </div>
  );
};
