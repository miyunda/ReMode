// Small shared presentational pieces.
import type { ReactNode } from 'react';
import { codeLabel } from '../lib/labels';

export function CodeChip({ code }: { code: string }) {
  return <code className="code-chip">{code}</code>;
}

/** Severity is spelled out and marked with a symbol, never shown by colour alone. */
export function Severity({ level }: { level: 'error' | 'warning' | 'info' }) {
  const map = {
    error: { sym: '✕', text: '错误', cls: 'text-danger-text border-love' },
    warning: { sym: '!', text: '警告', cls: 'text-warn-text border-gold' },
    info: { sym: 'i', text: '提示', cls: 'text-accent-text border-foam' },
  }[level];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-semibold ${map.cls}`}
    >
      <span aria-hidden="true">{map.sym}</span>
      {map.text}
    </span>
  );
}

/** A coded issue: severity, code, Chinese title, text and optional core detail. */
export function Issue({
  level,
  code,
  text,
  detail,
  location,
  children,
}: {
  level: 'error' | 'warning' | 'info';
  code: string;
  text?: string;
  detail?: string;
  location?: string;
  children?: ReactNode;
}) {
  return (
    <li
      className="flex flex-col gap-1 rounded-lg border border-hl-med bg-base p-2 text-sm"
      data-code={code}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Severity level={level} />
        <CodeChip code={code} />
        <span className="font-medium">{codeLabel(code)}</span>
        {location && <span className="text-xs text-muted-text">{location}</span>}
      </div>
      {text && <p>{text}</p>}
      {detail && detail !== text && <p className="text-xs break-words text-muted-text">{detail}</p>}
      {children}
    </li>
  );
}

export function Section({
  id,
  title,
  subtitle,
  children,
  actions,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="panel flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-title`} className="flex flex-wrap items-baseline gap-2">
          <span className="panel-title">{title}</span>
          {subtitle && <span className="text-sm font-medium text-text">{subtitle}</span>}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Horizontal scrolling is confined to the table, never the page. */
export function TableScroll({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="max-w-full overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
