import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Icon, type IconName } from './Icon';
import './controls.css';

// ── Buttons ─────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'solid' | 'ghost' | 'quiet';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
}

export function Button({ variant = 'solid', size = 'md', icon, iconRight, className = '', children, ...rest }: ButtonProps) {
  const iconSize = size === 'lg' ? 18 : size === 'sm' ? 15 : 17;
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconRight && <Icon name={iconRight} size={iconSize - 2} />}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: number;
  active?: boolean;
}

export function IconButton({ icon, label, size = 19, active, className = '', ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? 'is-active' : ''} ${className}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

// ── Segmented control ───────────────────────────────────────────────────────

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
}

export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: SegmentedProps<T>) {
  return (
    <div className={`seg seg-${size}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Tabs (underline) ────────────────────────────────────────────────────────

interface TabsProps<T extends string> {
  value: T;
  options: { value: T; label: ReactNode; count?: number }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

export function Tabs<T extends string>({ value, options, onChange, label, className = '' }: TabsProps<T>) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length];
    onChange(next.value);
    (e.currentTarget.querySelector(`[data-tab="${next.value}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className={`tabs ${className}`} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          data-tab={o.value}
          aria-selected={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className="tab-count num">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Switch ──────────────────────────────────────────────────────────────────

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  );
}

// ── Popover ─────────────────────────────────────────────────────────────────

/** Closes on outside click and Escape. Placement flips upward when there is no room below. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return { open, setOpen, rootRef };
}

function usePlacement(open: boolean, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>) {
  const [up, setUp] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const a = anchor.current.getBoundingClientRect();
    const p = panel.current.getBoundingClientRect();
    setUp(a.bottom + p.height + 12 > window.innerHeight && a.top > p.height + 12);
    setAlignRight(a.left + p.width + 12 > window.innerWidth);
  }, [open, anchor, panel]);
  return { up, alignRight };
}

export interface MenuItem {
  key: string;
  label: ReactNode;
  icon?: IconName;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  onSelect: () => void;
}

interface MenuProps {
  trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  items: (MenuItem | 'divider')[];
  heading?: ReactNode;
  width?: number;
}

export function Menu({ trigger, items, heading, width = 220 }: MenuProps) {
  const { open, setOpen, rootRef } = usePopover();
  const panelRef = useRef<HTMLDivElement>(null);
  const { up, alignRight } = usePlacement(open, rootRef, panelRef);
  const id = useId();
  const [focus, setFocus] = useState(-1);
  const selectable = items.filter((i): i is MenuItem => i !== 'divider' && !i.disabled);

  useEffect(() => {
    if (open) {
      const idx = selectable.findIndex((i) => i.checked);
      setFocus(idx >= 0 ? idx : 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelectorAll<HTMLButtonElement>('[data-menu-item]')[focus]?.focus();
  }, [focus, open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocus((f) => (f + 1) % selectable.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocus((f) => (f - 1 + selectable.length) % selectable.length);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="menu-root" ref={rootRef}>
      {trigger({ open, toggle: () => setOpen(!open), id })}
      {open && (
        <div
          ref={panelRef}
          id={id}
          className={`menu-panel ${up ? 'is-up' : ''} ${alignRight ? 'is-right' : ''}`}
          role="menu"
          style={{ width }}
          onKeyDown={onKeyDown}
        >
          {heading && <div className="menu-heading">{heading}</div>}
          {items.map((item, i) =>
            item === 'divider' ? (
              <div key={`d${i}`} className="menu-divider" role="separator" />
            ) : (
              <button
                key={item.key}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked}
                data-menu-item={item.disabled ? undefined : ''}
                disabled={item.disabled}
                className={`menu-item ${item.danger ? 'is-danger' : ''}`}
                onClick={() => {
                  item.onSelect();
                  setOpen(false);
                }}
              >
                <span className="menu-item-icon">
                  {item.checked ? <Icon name="check" size={16} /> : item.icon ? <Icon name={item.icon} size={16} /> : null}
                </span>
                <span className="menu-item-label">{item.label}</span>
                {item.hint && <span className="menu-item-hint">{item.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ── Select ──────────────────────────────────────────────────────────────────

interface SelectProps<T extends string | number> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  width?: number;
  prefix?: ReactNode;
}

export function Select<T extends string | number>({ value, options, onChange, label, width = 200, prefix }: SelectProps<T>) {
  const current = options.find((o) => o.value === value);
  return (
    <Menu
      width={Math.max(width, 180)}
      items={options.map((o) => ({
        key: String(o.value),
        label: o.label,
        checked: o.value === value,
        onSelect: () => onChange(o.value),
      }))}
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          className={`select ${open ? 'is-open' : ''}`}
          style={{ minWidth: width }}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={id}
          aria-label={`${label}: ${current?.label ?? ''}`}
          onClick={toggle}
        >
          {prefix && <span className="select-prefix">{prefix}</span>}
          <span className="select-value">{current?.label ?? label}</span>
          <Icon name="chevronDown" size={15} />
        </button>
      )}
    />
  );
}

// ── Progress bar ────────────────────────────────────────────────────────────

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`progress ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
