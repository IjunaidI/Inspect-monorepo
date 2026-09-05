import type {
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { ui } from './tokens';

/**
 * The console's form primitives (INS-092). Before this file the same two style
 * objects — the 11px uppercase label and the 36px hairline control — were
 * copy-pasted into eight forms under app/(console) and drifted by a pixel here
 * and there. They are declared once below; forms compose `Field` + a control
 * and override only what genuinely differs (a taller textarea, a mono input).
 *
 * No hooks, no 'use client': Server Components and client forms both render
 * these. The borders are LONGHAND on purpose — an `invalid` control swaps only
 * `borderColor`, and mixing `border` shorthand with a longhand in one merged
 * style object makes React warn and leaves a stale colour behind on re-render.
 */

export const fieldLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: ui.sub,
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

export const controlStyle: CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  color: ui.ink,
  background: '#fff',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: ui.line,
  borderRadius: 8,
  outline: 'none',
  boxSizing: 'border-box',
};

export const hintStyle: CSSProperties = { fontSize: 11, color: ui.faint, marginTop: 5, lineHeight: 1.45 };
export const errorStyle: CSSProperties = { fontSize: 11, color: ui.danger, marginTop: 4, lineHeight: 1.45 };

/**
 * Label + control + one line under it. `error` wins over `hint` so the message
 * replaces the help text rather than stacking under it. Pass `htmlFor` with a
 * matching `id` on the control to link them; a group of controls (a GPS pair)
 * simply omits it.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  style,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={style}>
      <label htmlFor={htmlFor} style={fieldLabelStyle}>
        {label}
      </label>
      {children}
      {error ? (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      ) : hint ? (
        <div style={hintStyle}>{hint}</div>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Paints the hairline in `ui.danger`; the message itself belongs to `Field.error`. */
  invalid?: boolean;
}

export function Input({ invalid = false, style, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      {...props}
      style={{ ...controlStyle, ...(invalid ? { borderColor: ui.danger } : null), ...style }}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ invalid = false, style, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      {...props}
      style={{
        ...controlStyle,
        height: 'auto',
        padding: '6px 10px',
        lineHeight: 1.5,
        resize: 'vertical',
        ...(invalid ? { borderColor: ui.danger } : null),
        ...style,
      }}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export function Select({ invalid = false, style, ...props }: SelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      {...props}
      style={{
        ...controlStyle,
        padding: '0 8px',
        cursor: props.disabled ? 'default' : 'pointer',
        ...(invalid ? { borderColor: ui.danger } : null),
        ...style,
      }}
    />
  );
}

/**
 * A value that exists but cannot be changed here — e.g. the parties on a PO,
 * which are fixed once the row exists. Rendered as a control so the form reads
 * as one column, but never focusable and never submitted.
 */
export function ReadOnlyValue({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        ...controlStyle,
        display: 'flex',
        alignItems: 'center',
        background: ui.fill,
        color: ui.sub,
        borderColor: ui.lineSoft,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
