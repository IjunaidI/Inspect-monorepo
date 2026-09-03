// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { Modal } from './modal';

afterEach(cleanup);

describe('Modal', () => {
  it('renders title and children through a portal with dialog semantics', () => {
    render(
      <Modal title="New company" onClose={() => {}}>
        <input aria-label="Name" />
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('New company')).toBeTruthy();
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it('moves focus inside on open and locks body scroll while open', () => {
    const { unmount } = render(
      <Modal title="T" onClose={() => {}}>
        <input aria-label="First" />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('First'));
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('Escape closes only the topmost of two stacked modals', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Modal title="Outer" onClose={outer}>
          <button>a</button>
        </Modal>
        <Modal title="Inner" onClose={inner}>
          <button>b</button>
        </Modal>
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('backdrop click closes, panel click does not', () => {
    const onClose = vi.fn();
    render(
      <Modal title="T" onClose={onClose}>
        <button>inside</button>
      </Modal>,
    );
    fireEvent.click(screen.getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
