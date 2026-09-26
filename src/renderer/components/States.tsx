import type { ReactNode } from 'react';
import { Button } from './Controls';
import { Icon, type IconName } from './Icon';
import './states.css';

interface EmptyProps {
  icon?: IconName;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon, title, body, action, compact }: EmptyProps) {
  return (
    <div className={`empty ${compact ? 'is-compact' : ''}`}>
      {icon && (
        <span className="empty-icon">
          <Icon name={icon} size={compact ? 22 : 28} />
        </span>
      )}
      <h3 className="empty-title">{title}</h3>
      {body && <p className="empty-body">{body}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/** Turns transport errors into something a person can act on. */
export function friendlyError(error: Error | null | undefined): string {
  const msg = error?.message ?? '';
  if (/fetch failed|ENOTFOUND|ECONN|network|timed? ?out|aborted/i.test(msg)) return 'The connection dropped. Check your internet and try again.';
  if (/429|rate/i.test(msg)) return 'AniList is asking us to slow down. Give it a minute, then try again.';
  if (/HTTP 5\d\d/.test(msg)) return 'The source is having trouble right now. Try again in a moment.';
  return msg || 'Something went wrong.';
}

export function ErrorState({ error, onRetry, title = 'Couldn’t load this', compact }: { error?: Error | null; onRetry?: () => void; title?: string; compact?: boolean }) {
  return (
    <EmptyState
      compact={compact}
      icon="alert"
      title={title}
      body={friendlyError(error)}
      action={onRetry && <Button icon="refresh" onClick={onRetry}>Try again</Button>}
    />
  );
}

export function Spinner({ size = 22, label }: { size?: number; label?: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" style={{ width: size, height: size }} />
      {label && <span className="spinner-label">{label}</span>}
    </span>
  );
}
