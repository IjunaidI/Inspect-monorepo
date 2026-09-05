// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { Field, Input, ReadOnlyValue, Select, Textarea } from './field';
import { ui } from './tokens';

afterEach(cleanup);

/** jsdom serialises inline colours as rgb(); the tokens are hex. */
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('Field', () => {
  it('links the label to the control and shows the hint', () => {
    render(
      <Field label="Name *" htmlFor="name" hint="Shown on the report.">
        <Input id="name" name="name" />
      </Field>,
    );
    const input = screen.getByLabelText('Name *');
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('name')).toBe('name');
    expect(screen.getByText('Shown on the report.')).toBeTruthy();
  });

  it('an error replaces the hint and is announced', () => {
    render(
      <Field label="Lat" hint="Decimal degrees" error="Enter both or neither.">
        <Input name="lat" />
      </Field>,
    );
    expect(screen.queryByText('Decimal degrees')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('Enter both or neither.');
  });
});

describe('controls', () => {
  it('Input carries the hairline and swaps only the border colour when invalid', () => {
    render(
      <>
        <Input aria-label="ok" />
        <Input aria-label="bad" invalid />
      </>,
    );
    const ok = screen.getByLabelText('ok');
    const bad = screen.getByLabelText('bad');
    expect(ok.style.borderColor).toBe(rgb(ui.line));
    expect(ok.style.height).toBe('36px');
    expect(ok.getAttribute('aria-invalid')).toBeNull();
    expect(bad.style.borderColor).toBe(rgb(ui.danger));
    expect(bad.getAttribute('aria-invalid')).toBe('true');
  });

  it('caller style overrides win, and Textarea/Select keep the shared base', () => {
    render(
      <>
        <Textarea aria-label="t" style={{ minHeight: 132 }} />
        <Select aria-label="s" defaultValue="b">
          <option value="a">A</option>
          <option value="b">B</option>
        </Select>
        <ReadOnlyValue>Fixed</ReadOnlyValue>
      </>,
    );
    const t = screen.getByLabelText('t');
    expect(t.style.minHeight).toBe('132px');
    expect(t.style.borderRadius).toBe('8px');
    const s = screen.getByLabelText('s') as HTMLSelectElement;
    expect(s.value).toBe('b');
    expect(s.style.height).toBe('36px');
    expect(screen.getByText('Fixed')).toBeTruthy();
  });
});
