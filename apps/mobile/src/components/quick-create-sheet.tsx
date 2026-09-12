/**
 * @deprecated INS-095 — the sheet chrome is `Sheet` in the kit and
 * `describeCreateError` moved to `@/lib/errors`. This wrapper keeps the INS-091
 * quick-create call sites compiling until INS-096 re-points them.
 */
import type { ReactNode } from 'react';

import { Sheet } from './ui/sheet';

export { describeCreateError } from '@/lib/errors';

export function QuickCreateSheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      {children}
    </Sheet>
  );
}
