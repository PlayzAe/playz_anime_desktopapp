import type { ListStatus, MediaSnapshot } from '../../shared/types';
import { useApp } from '../lib/store';
import { Menu } from './Controls';
import { Icon } from './Icon';

export function statusLabel(status: ListStatus, manga: boolean): string {
  switch (status) {
    case 'watching':
      return manga ? 'Reading' : 'Watching';
    case 'planning':
      return manga ? 'Plan to read' : 'Plan to watch';
    case 'completed':
      return 'Completed';
    case 'paused':
      return 'Paused';
    case 'dropped':
      return 'Dropped';
  }
}

const ORDER: ListStatus[] = ['watching', 'planning', 'completed', 'paused', 'dropped'];

export function ListButton({ media, size = 'lg', variant = 'ghost' }: { media: MediaSnapshot; size?: 'md' | 'lg'; variant?: 'ghost' | 'solid' }) {
  const { statusOf, setStatus, toast } = useApp();
  const status = statusOf(media.id);
  const manga = media.type === 'MANGA';

  const choose = async (next: ListStatus | null) => {
    await setStatus(media, next);
    toast(next ? `${media.title} is in ${statusLabel(next, manga)}` : `Removed ${media.title} from your library`, {
      action: next ? undefined : { label: 'Undo', run: () => void setStatus(media, status) },
    });
  };

  return (
    <Menu
      width={210}
      heading="Library"
      items={[
        ...ORDER.map((s) => ({ key: s, label: statusLabel(s, manga), checked: s === status, onSelect: () => void choose(s) })),
        ...(status ? (['divider', { key: 'remove', label: 'Remove from library', icon: 'trash' as const, danger: true, onSelect: () => void choose(null) }] as const) : []),
      ]}
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          className={`btn btn-${variant} btn-${size} list-btn ${status ? 'is-set' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
        >
          <Icon name={status ? 'bookmarkFilled' : 'bookmark'} size={17} />
          {status ? statusLabel(status, manga) : 'Add to library'}
          <Icon name="chevronDown" size={14} />
        </button>
      )}
    />
  );
}
