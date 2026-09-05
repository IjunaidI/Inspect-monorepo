// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { Breadcrumb } from './breadcrumb';

afterEach(cleanup);

describe('Breadcrumb', () => {
  it('links every crumb but the last, which is the current page', () => {
    render(
      <Breadcrumb
        items={[
          { label: 'Inspections', href: '/inspections' },
          { label: 'PO-2026-NV-0042', href: '/inspections/abc/review', mono: true },
          { label: 'Review', href: '/should-not-render' },
        ]}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/inspections', '/inspections/abc/review']);
    expect(links.map((a) => a.textContent)).toEqual(['Inspections', 'PO-2026-NV-0042']);

    const current = within(nav).getByText('Review').closest('li');
    expect(current?.getAttribute('aria-current')).toBe('page');
    expect(within(current as HTMLElement).queryByRole('link')).toBeNull();
  });

  it('renders a crumb without href as plain text', () => {
    render(<Breadcrumb items={[{ label: 'Inspections' }, { label: 'New inspection' }]} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Inspections')).toBeTruthy();
    expect(screen.getByText('New inspection').closest('li')?.getAttribute('aria-current')).toBe('page');
  });
});
