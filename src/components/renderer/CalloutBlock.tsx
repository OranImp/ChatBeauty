import React from 'react';

export type CalloutKind = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

const CALLOUT_META: Record<
  CalloutKind,
  {
    label: string;
    borderClass: string;
    bgClass: string;
    labelClass: string;
  }
> = {
  NOTE: {
    label: '说明',
    borderClass: 'border-borderc border-l-fg/40',
    bgClass: 'bg-surface/45',
    labelClass: 'text-fg',
  },
  TIP: {
    label: '提示',
    borderClass: 'border-borderc border-l-fg/60',
    bgClass: 'bg-surface/45',
    labelClass: 'text-fg',
  },
  IMPORTANT: {
    label: '要点',
    borderClass: 'border-borderc border-l-fg/80',
    bgClass: 'bg-surface/55',
    labelClass: 'text-fg',
  },
  WARNING: {
    label: '注意',
    borderClass: 'border-amber-500/30 border-l-amber-400/70',
    bgClass: 'bg-amber-500/[0.05]',
    labelClass: 'text-amber-300',
  },
  CAUTION: {
    label: '警告',
    borderClass: 'border-rose-500/30 border-l-rose-400/70',
    bgClass: 'bg-rose-500/[0.05]',
    labelClass: 'text-rose-300',
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
  return (
    <div
      className={`my-4 rounded-xl border-l-[3px] border ${meta.borderClass} ${meta.bgClass} px-4 py-3`}
    >
      <div className={`text-xs font-semibold mb-1.5 ${meta.labelClass}`}>
        {meta.label}
      </div>
      <div className="text-[0.95em] leading-relaxed [&>p:last-child]:mb-0 [&>p:first-child]:mt-0">
        {children}
      </div>
    </div>
  );
};
