import React, { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ProtocolType } from '@/types/chat';
import { PROTOCOL_TEMPLATES } from '@/services/llm/registry';
import { Collapsible } from '@/components/ui/MotionPrimitives';

interface ProtocolSelectorProps {
  value: ProtocolType;
  onChange: (next: ProtocolType) => void;
  label?: string;
}

const ENDPOINT_HINTS: Record<ProtocolType, string> = {
  'openai-chat': '/chat/completions',
  'openai-responses': '/responses',
  gemini: 'streamGenerateContent',
  anthropic: '/v1/messages',
};

export const ProtocolSelector: React.FC<ProtocolSelectorProps> = ({
  value,
  onChange,
  label = '调用协议',
}) => {
  const [open, setOpen] = useState(false);
  const activeTpl = PROTOCOL_TEMPLATES[value];

  return (
    <div className="space-y-1.5 min-w-0">
      <div className="text-muted text-xs">{label}</div>
      <div className="rounded-xl border border-borderc bg-bg/70 overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full min-w-0 flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-fg/[0.03] transition"
        >
          <div className="min-w-0 flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[13.5px] text-fg">{activeTpl.shortLabel}</span>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-fg/10 text-muted truncate max-w-full">
              {ENDPOINT_HINTS[value]}
            </span>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-muted shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              open ? 'rotate-180 text-fg' : ''
            }`}
          />
        </button>

        <Collapsible open={open}>
          <div className="border-t border-borderc divide-y divide-borderc/60 bg-surface/40">
            {(Object.keys(PROTOCOL_TEMPLATES) as ProtocolType[]).map((proto) => {
              const tpl = PROTOCOL_TEMPLATES[proto];
              const selected = proto === value;
              return (
                <button
                  key={proto}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onChange(proto);
                  }}
                  className={`w-full min-w-0 flex items-start justify-between gap-2.5 px-3 py-2.5 text-left transition ${
                    selected ? 'bg-elevated text-fg' : 'hover:bg-fg/[0.04] text-fg'
                  }`}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-[13px]">{tpl.shortLabel}</span>
                      <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-fg/10 text-muted">
                        {ENDPOINT_HINTS[proto]}
                      </span>
                    </div>
                    <div className="text-xs text-muted leading-relaxed break-words">
                      {tpl.description}
                    </div>
                  </div>
                  {selected && <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" />}
                </button>
              );
            })}
          </div>
        </Collapsible>
      </div>
    </div>
  );
};
