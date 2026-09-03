'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { filterOptions } from '@inspect/domain';
import { ui } from './tokens';

export interface PickerOption {
  id: string;
  label: string;
  hint?: string;
}

const lbl: CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: ui.sub, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 };

/**
 * Searchable entity combobox (INS-091). Replaces native <select> wherever the
 * user picks a company / product / PO. The optional footer row "+ Add new…"
 * never changes the value — it hands control to the host, which opens a
 * quick-create dialog and, on success, appends + selects the new row.
 * Search goes through the shared `filterOptions` so web and mobile match alike.
 */
export function EntityPicker({
  name,
  label,
  options,
  value,
  onChange,
  placeholder = 'Select…',
  emptyText = 'Nothing to choose from yet.',
  createLabel = '+ Add new…',
  onCreate,
  hintText,
  invalid = false,
  disabled = false,
}: {
  name?: string;
  label: string;
  options: PickerOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  emptyText?: string;
  createLabel?: string;
  onCreate?: () => void;
  hintText?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const labelId = useId();

  const filtered = useMemo(() => filterOptions(query, options, (o) => o.label), [query, options]);
  const selected = options.find((o) => o.id === value);
  const rowCount = filtered.length + (onCreate ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
        setActive(0);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery('');
    setActive(0);
  }

  function pick(index: number) {
    if (index < filtered.length) {
      onChange(filtered[index].id);
      close();
    } else if (onCreate) {
      close();
      onCreate();
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(rowCount - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rowCount > 0) pick(active);
    }
  }

  const row = (isActive: boolean, isSelected: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '9px 12px',
    fontSize: 13,
    fontFamily: 'inherit',
    textAlign: 'left',
    color: ui.ink,
    background: isActive ? ui.accentSoft : 'transparent',
    fontWeight: isSelected ? 600 : 400,
    borderWidth: 0,
    cursor: 'pointer',
  });

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <span id={labelId} style={lbl}>{label}</span>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          height: 36,
          padding: '0 10px',
          fontSize: 13,
          fontFamily: 'inherit',
          textAlign: 'left',
          color: selected ? ui.ink : ui.faint,
          background: '#fff',
          border: `1px solid ${invalid ? ui.danger : ui.line}`,
          borderRadius: 8,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} color={ui.faint} />
      </button>
      {hintText && <div style={{ fontSize: 11, color: invalid ? ui.danger : ui.faint, marginTop: 4 }}>{hintText}</div>}

      {open && (
        <div
          style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 8, zIndex: 60, overflow: 'hidden' }}
          onKeyDown={onKey}
        >
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Search…"
            aria-controls={listId}
            style={{ width: '100%', height: 34, padding: '0 12px', fontSize: 13, fontFamily: 'inherit', border: 'none', borderBottom: `1px solid ${ui.lineSoft}`, outline: 'none', boxSizing: 'border-box' }}
          />
          <div id={listId} role="listbox" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12.5, color: ui.faint }}>
                {query ? 'No matches.' : emptyText}
              </div>
            )}
            {filtered.map((o, i) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={o.id === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
                style={row(i === active, o.id === value)}
              >
                <span style={{ flex: 1 }}>{o.label}</span>
                {o.hint && <span style={{ fontSize: 11.5, color: ui.faint }}>{o.hint}</span>}
              </button>
            ))}
          </div>
          {onCreate && (
            <button
              type="button"
              onMouseEnter={() => setActive(filtered.length)}
              onClick={() => pick(filtered.length)}
              style={{ ...row(active === filtered.length, false), color: ui.accent, fontWeight: 550, borderTop: `1px solid ${ui.lineSoft}` }}
            >
              {createLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
