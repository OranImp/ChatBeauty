import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Collapsible } from '@/components/ui/MotionPrimitives';

interface SettingsSectionProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Inset grouped card container styled after ChatGPT settings sections,
 * keeping rows evenly padded and separated by subtle hairline dividers.
 */
export const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  description,
  action,
  children,
  className,
}) => {
  return (
    <section className={`min-w-0 max-w-full ${className || ''}`}>
      {(title || description || action) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2 min-w-0">
          <div className="min-w-0">
            {title && (
              <h3 className="text-xs font-semibold text-muted tracking-wide uppercase">
                {title}
              </h3>
            )}
            {description && <p className="text-xs text-muted/85 mt-0.5">{description}</p>}
          </div>
          {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="rounded-2xl border border-borderc bg-surface/45 divide-y divide-borderc overflow-hidden min-w-0">
        {children}
      </div>
    </section>
  );
};

interface SettingsRowProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}

/**
 * Standard horizontal key-control row with consistent icon alignment and
 * responsive trailing wrapping on narrow mobile screens.
 */
export const SettingsRow: React.FC<SettingsRowProps> = ({
  icon,
  title,
  description,
  trailing,
  className,
}) => {
  return (
    <div
      className={`flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-3 gap-y-2.5 px-3.5 sm:px-4 py-3 min-h-[48px] min-w-0 ${
        className || ''
      }`}
    >
      <div className="flex items-center gap-3 min-w-[min(185px,100%)] flex-1">
        {icon && (
          <span className="w-8 h-8 rounded-xl bg-fg/[0.06] border border-borderc flex items-center justify-center text-muted shrink-0">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-fg leading-snug break-words">{title}</div>
          {description && (
            <div className="text-xs text-muted mt-0.5 leading-relaxed break-words">
              {description}
            </div>
          )}
        </div>
      </div>
      {trailing !== undefined && trailing !== null && (
        <div className="shrink-0 flex items-center gap-2 max-w-full">{trailing}</div>
      )}
    </div>
  );
};

interface SettingsNavRowProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  value?: React.ReactNode;
  badge?: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}

/**
 * Clickable navigation row used in Level-1 mobile settings menus and preset lists.
 */
export const SettingsNavRow: React.FC<SettingsNavRowProps> = ({
  icon,
  title,
  description,
  value,
  badge,
  onClick,
  active,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-center justify-between gap-3 px-3.5 sm:px-4 py-3 min-h-[48px] min-w-0 transition hover:bg-fg/[0.04] active:bg-fg/[0.06] ${
        active ? 'bg-elevated/70' : ''
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {icon && (
          <span className="w-8 h-8 rounded-xl bg-fg/[0.06] border border-borderc flex items-center justify-center text-muted shrink-0">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="text-[13.5px] font-medium text-fg truncate">{title}</span>
            {badge}
          </div>
          {description && (
            <div className="text-xs text-muted mt-0.5 leading-relaxed line-clamp-2 break-words">
              {description}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 min-w-0">
        {value !== undefined && value !== null && value !== '' && (
          <span className="text-xs text-muted truncate max-w-[100px] sm:max-w-[180px]">
            {value}
          </span>
        )}
        <ChevronRight className="w-4 h-4 text-muted/75 shrink-0" />
      </div>
    </button>
  );
};

interface SettingsToggleRowProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}

export const SettingsToggleRow: React.FC<SettingsToggleRowProps> = ({
  icon,
  title,
  description,
  checked,
  onChange,
  ariaLabel,
}) => {
  return (
    <SettingsRow
      icon={icon}
      title={title}
      description={description}
      trailing={<ToggleSwitch checked={checked} onChange={onChange} ariaLabel={ariaLabel} />}
    />
  );
};

interface SettingsCollapsibleRowProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  value?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  keepMounted?: boolean;
}

/**
 * Progressive-disclosure accordion row embedded inside a SettingsSection.
 */
export const SettingsCollapsibleRow: React.FC<SettingsCollapsibleRowProps> = ({
  icon,
  title,
  description,
  value,
  open,
  onToggle,
  children,
  keepMounted = false,
}) => {
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left flex items-center justify-between gap-3 px-3.5 sm:px-4 py-3 min-h-[48px] min-w-0 transition hover:bg-fg/[0.04]"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {icon && (
            <span className="w-8 h-8 rounded-xl bg-fg/[0.06] border border-borderc flex items-center justify-center text-muted shrink-0">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium text-fg break-words">{title}</div>
            {description && (
              <div className="text-xs text-muted mt-0.5 leading-relaxed break-words">
                {description}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 min-w-0">
          {value !== undefined && value !== null && value !== '' && (
            <span className="text-xs text-muted truncate max-w-[120px] sm:max-w-[160px]">
              {value}
            </span>
          )}
          <ChevronRight
            className={`w-4 h-4 text-muted shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              open ? 'rotate-90 text-fg' : ''
            }`}
          />
        </div>
      </button>
      <Collapsible open={open} keepMounted={keepMounted}>
        <div className="px-3.5 sm:px-4 pb-3.5 pt-2.5 border-t border-borderc bg-bg/35 min-w-0">
          {children}
        </div>
      </Collapsible>
    </div>
  );
};
