/**
 * The mobile component kit (INS-095) — the one vocabulary every screen
 * composes from. Values come from `@/theme`; nothing here hardcodes a hex.
 *
 * The pre-kit names (`Field`, `Input`, `Button`, `Chip`, `TextButton`,
 * `MIN_TARGET`, the `ui` StyleSheet) resolve from this barrel too, so the
 * `@/components/ui` import path every screen already uses keeps working while
 * the screens are re-skinned batch by batch (INS-096).
 */
export { Icon, type IconName, type IconSize } from './icon';
export { Button, ButtonRow, TextButton, type ButtonSize, type ButtonVariant, type TextButtonTone } from './button';
export { Field, Input, Textarea } from './field';
export { Chip } from './chip';
export { Badge, SeverityBadge, StatusChip, humanizeStatus } from './badge';
export { Card, ListCard, type CardTone } from './card';
export { ListRow } from './list-row';
export { Grid, StatCard } from './stat-card';
export { IconTile } from './icon-tile';
export { BackButton, Header, type BackProps, type HeaderAction } from './header';
export { Screen } from './screen';
export { Section, SectionHeading, SectionLabel, type SectionAction } from './section';
export { Sheet, type SheetVariant } from './sheet';
export { ProgressBar } from './progress-bar';
export { EmptyState, ErrorState, Skeleton, SkeletonRows } from './states';
export { TabBar } from './tab-bar';
export { Avatar } from './avatar';
export { MIN_TARGET, ui } from './legacy';
