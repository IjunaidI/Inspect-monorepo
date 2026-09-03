// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EntityPicker } from './entity-picker';

afterEach(cleanup);

const options = [
  { id: 'c1', label: 'Acme Factory Ltd' },
  { id: 'c2', label: 'Northwind Apparel' },
  { id: 'c3', label: 'São Paulo Textiles' },
];

function setup(extra: Partial<Parameters<typeof EntityPicker>[0]> = {}) {
  const onChange = vi.fn();
  const onCreate = vi.fn();
  const utils = render(
    <EntityPicker
      name="clientCompanyId"
      label="Client"
      options={options}
      value=""
      onChange={onChange}
      placeholder="Select the client…"
      emptyText="No companies yet."
      {...extra}
    />,
  );
  return { ...utils, onChange, onCreate };
}

describe('EntityPicker', () => {
  it('opens on click, filters on typing, and selects with a click', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('combobox', { name: /client/i }));
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(3);
    await user.type(screen.getByPlaceholderText('Search…'), 'sao');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    await user.click(within(list).getByRole('option'));
    expect(onChange).toHaveBeenCalledWith('c3');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('arrow keys + Enter select and Escape closes', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('c2');
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('writes the selected id to the hidden input and shows its label', () => {
    setup({ value: 'c2' });
    const hidden = document.querySelector<HTMLInputElement>('input[name="clientCompanyId"]');
    expect(hidden?.value).toBe('c2');
    expect(screen.getByRole('combobox').textContent).toContain('Northwind Apparel');
  });

  it('shows the "+ Add new" footer only when onCreate is given, and it fires without changing the value', async () => {
    const user = userEvent.setup();
    const { onChange, onCreate, rerender } = setup();
    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByText('+ Add new company…')).toBeNull();
    await user.keyboard('{Escape}');

    rerender(
      <EntityPicker
        name="clientCompanyId"
        label="Client"
        options={options}
        value=""
        onChange={onChange}
        createLabel="+ Add new company…"
        onCreate={onCreate}
      />,
    );
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('+ Add new company…'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders emptyText and keeps the footer when there are no options', async () => {
    const user = userEvent.setup();
    setup({ options: [], createLabel: '+ Add new company…', onCreate: vi.fn() });
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByText('No companies yet.')).toBeTruthy();
    expect(screen.getByText('+ Add new company…')).toBeTruthy();
  });
});
