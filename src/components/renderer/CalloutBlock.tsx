import React from 'react';
import { AlertCircle, AlertTriangle, Info, Lightbulb, ShieldAlert } from 'lucide-react';

export type CalloutKind = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

const CALLOUT_META: Record<
  CalloutKind,
  {
    label: string;
    borderClass: string;
    bgClass: string;
    textClass: string;
    Icon: React.FC<{ className?: string }>;
  }
> = {
  NOTE: {
    label: '说明 · NOTE',
    borderClass: 'border-sky-500/40',
    bgClass: 'bg-sky-500/10',
    textClass: 'text-sky-400',
    Icon: Info,
  },
  TIP: {
    label: '直觉提示 · TIP',
    borderClass: 'border-emerald-500/40',
    bgClass: 'bg-emerald-500/10',
    textClass: 'text-emerald-400',
    Icon: Lightbulb,
  },
  IMPORTANT: {
    label: '核心要点 · IMPORTANT',
    borderClass: 'border-violet-500/40',
    bgClass: 'bg-violet-500/10',
    textClass: 'text-violet-400',
    Icon: AlertCircle,
  },
  WARNING: {
    label: '易错警告 · WARNING',
    borderClass: 'border-amber-500/40',
    bgClass: 'bg-amber-500/10',
    textClass: 'text-amber-400',
    Icon: AlertTriangle,
  },
  CAUTION: {
    label: '关键禁忌 · CAUTION',
    borderClass: 'border-rose-500/40',
    bgClass: 'bg-rose-500/10',
    textClass: 'text-rose-400',
    Icon: ShieldAlert,
  },
};

export function extractCalloutFromChildren(children: React.ReactNode): {
  kind: CalloutKind | null;
  cleanedChildren: React.ReactNode;
} {
  const arr = React.Children.toArray(children);
  for (let i = 0; i < arr.length; i++) {
    const child = arr[i];
    if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
      const inner = React.Children.toArray(child.props.children);
      if (inner.length > 0 && typeof inner[0] === 'string') {
        const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?([\s\S]*)$/i.exec(inner[0]);
        if (match) {
          const kind = match[1].toUpperCase() as CalloutKind;
          const restFirst = match[2];
          const nextInner = restFirst ? [restFirst, ...inner.slice(1)] : inner.slice(1);
          const clonedFirst = React.cloneElement(child, undefined, ...nextInner);
          const nextArr = [...arr];
          if (nextInner.length === 0) {
            nextArr.splice(i, 1);
          } else {
            nextArr[i] = clonedFirst;
          }
          return { kind, cleanedChildren: nextArr };
        }
      }
      break;
    }
  }
  return { kind: null, cleanedChildren: children };
}

export const CalloutBlock: React.FC<{ kind: CalloutKind; children: React.ReactNode }> = ({
  kind,
  children,
}) => {
  const meta = CALLOUT_META[kind];
  const { Icon } = meta;
  return (
    <div
      className={`my-4 rounded-xl border-l-4 border ${meta.borderClass} ${meta.bgClass} px-4 py-3`}
    >
      <div className={`flex items-center gap-2 text-xs font-semibold tracking-wide mb-1.5 ${meta.textClass}`}>
        <Icon className="w-4 h-4 shrink-0" />
        <span>{meta.label}</span>
      </div>
      <div className="text-[0.95em] leading-relaxed [&>p:last-child]:mb-0 [&>p:first-child]:mt-0">
        {children}
      </div>
    </div>
  );
};
