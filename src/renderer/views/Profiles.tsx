import { useMemo, useState, type ReactNode } from 'react';
import type { ImportedProfile, ListStatus, MediaSnapshot, Profile } from '../../shared/types';
import { Button, Menu, Tabs } from '../components/Controls';
import { Icon } from '../components/Icon';
import { fromSnapshot, PosterCard } from '../components/Media';
import { Modal } from '../components/Modal';
import { Avatar, blankProfile, ProfileFields } from '../components/Profile';
import { startProfileImport } from '../components/ProfileDrop';
import { EmptyState } from '../components/States';
import { relativeTime } from '../lib/format';
import { Link, navigate } from '../lib/router';
import { useApp } from '../lib/store';
import './profiles.css';

const api = () => window.playzanime;

const STATUS_LABEL: Record<ListStatus, string> = {
  watching: 'Watching',
  planning: 'Planning',
  completed: 'Completed',
  paused: 'Paused',
  dropped: 'Dropped',
};

// ── /profiles ───────────────────────────────────────────────────────────────

export function Profiles() {
  const { profile, saveProfile, library, history, reading, imported, toast } = useApp();
  const [editing, setEditing] = useState<Profile | null>(null);

  const share = async () => {
    try {
      const file = await api().profile.export();
      if (file) toast(`Saved ${file.split(/[\\/]/).pop()}. Send it to a friend; they drop it onto PlayzAnime.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Couldn’t save the profile.', { tone: 'error' });
    }
  };
  const importFile = async () => {
    try {
      const text = await api().profile.pick();
      if (text) startProfileImport(text);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Couldn’t read that file.', { tone: 'error' });
    }
  };
  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast('Add a name first.');
      return;
    }
    await saveProfile({ ...editing, name: editing.name.trim() });
    setEditing(null);
    toast('Profile saved');
  };

  return (
    <div className="page profiles">
      <div className="page-head">
        <h1 className="page-title display">Profiles</h1>
        <p className="page-sub">Yours, and the ones friends have shared with you. Everything here stays on this computer.</p>
      </div>

      <section className="me">
        <Avatar profile={profile} size={112} own className="me-avatar" />
        <div className="me-main">
          <div className="me-eyebrow">You</div>
          <h2 className="me-name display">{profile?.name ?? 'Set up your profile'}</h2>
          <p className="me-tagline">{profile ? profile.tagline ?? 'No tagline yet.' : 'Add a name, a picture and your favourites. Friends see this when you share your profile.'}</p>
          <Stats library={library.length} watched={history.length} read={reading.length} favorites={profile?.favorites.length ?? 0} />
          <div className="me-actions">
            <Button variant="primary" icon={profile ? 'settings' : 'plus'} onClick={() => setEditing(profile ?? blankProfile())}>
              {profile ? 'Edit profile' : 'Create profile'}
            </Button>
            <Button variant="solid" icon="share" onClick={() => void share()}>
              Share as file
            </Button>
            <Button variant="ghost" icon="downloads" onClick={() => void importFile()}>
              Import a profile
            </Button>
          </div>
        </div>
      </section>

      {profile && profile.favorites.length > 0 && (
        <section className="prof-section">
          <h2 className="section-title">Your favourites</h2>
          <div className="poster-grid">
            {profile.favorites.map((m) => (
              <PosterCard key={m.id} media={fromSnapshot(m)} />
            ))}
          </div>
        </section>
      )}

      <section className="prof-section">
        <h2 className="section-title">
          From friends <span className="faint num">{imported.length}</span>
        </h2>
        {imported.length === 0 ? (
          <EmptyState
            compact
            icon="profiles"
            title="No shared profiles yet"
            body="When a friend sends you their .playzanime file, drop it anywhere in the app. Their lists show up here, separate from yours."
          />
        ) : (
          <div className="friends">
            {imported.map((p) => (
              <Link key={p.profile.id} to={`/profiles/${encodeURIComponent(p.profile.id)}`} className="friend">
                <Avatar profile={p.profile} size={56} />
                <div className="friend-main">
                  <span className="friend-name">{p.profile.name}</span>
                  <span className="friend-meta clamp-1">{p.profile.tagline ?? `${p.library.length} in library · ${p.history.length} watched`}</span>
                  <span className="friend-when">Imported {relativeTime(p.importedAt)}</span>
                </div>
                <div className="friend-covers" aria-hidden="true">
                  {covers(p)
                    .slice(0, 3)
                    .map((c) => (
                      <img key={c} src={c} alt="" loading="lazy" />
                    ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={profile ? 'Edit profile' : 'Create your profile'}
        width={620}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        {editing && <ProfileFields value={editing} onChange={setEditing} />}
      </Modal>
    </div>
  );
}

function covers(p: ImportedProfile): string[] {
  const all = [...p.profile.favorites, ...p.history.map((h) => h.media), ...p.library.map((l) => l.media)].map((m) => m.cover).filter(Boolean);
  return [...new Set(all)];
}

function Stats({ library, watched, read, favorites }: { library: number; watched: number; read: number; favorites: number }) {
  const items: [number, string][] = [
    [library, 'in library'],
    [watched, watched === 1 ? 'show watched' : 'shows watched'],
    [read, 'series read'],
    [favorites, 'favourites'],
  ];
  return (
    <dl className="stats">
      {items.map(([n, label]) => (
        <div key={label}>
          <dt className="num">{n}</dt>
          <dd>{label}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── /profiles/:id ───────────────────────────────────────────────────────────

type Tab = 'favorites' | 'watched' | 'library' | 'reading';

export function ProfileDetail({ id }: { id: string }) {
  const { imported, refreshImported, statusOf, setStatus, toast } = useApp();
  const p = imported.find((x) => x.profile.id === id);
  const [tab, setTab] = useState<Tab | null>(null);

  const lists = useMemo(() => {
    if (!p) return null;
    return {
      favorites: p.profile.favorites.map((m) => ({ media: m, meta: null as ReactNode })),
      watched: p.history.map((h) => ({ media: h.media, meta: <span className="num">Up to E{h.episode}</span> as ReactNode })),
      library: p.library.map((e) => ({ media: e.media, meta: <span>{STATUS_LABEL[e.status]}</span> as ReactNode })),
      reading: p.reading.map((r) => ({ media: r.media, meta: (r.chapterNumber ? <span className="num">Up to Ch. {r.chapterNumber}</span> : null) as ReactNode })),
    };
  }, [p]);

  if (!p || !lists) {
    return (
      <div className="page">
        <EmptyState icon="profiles" title="That profile isn’t here" body="It may have been removed." action={<Button onClick={() => navigate('/profiles')}>All profiles</Button>} />
      </div>
    );
  }

  const first: Tab = lists.favorites.length ? 'favorites' : lists.watched.length ? 'watched' : lists.library.length ? 'library' : 'reading';
  const current = tab ?? first;
  const items = lists[current];
  const missing = items.filter((i) => !statusOf(i.media.id));

  const add = async (m: MediaSnapshot) => {
    await setStatus(m, 'planning');
    toast(`Added ${m.title} to your Planning list`);
  };
  const addAll = async () => {
    for (const i of missing) await setStatus(i.media, 'planning');
    toast(`Added ${missing.length} to your Planning list`);
  };
  const remove = async () => {
    await api().profile.removeImported(p.profile.id);
    await refreshImported();
    navigate('/profiles', { replace: true });
    toast(`Removed ${p.profile.name}’s profile`);
  };

  return (
    <div className="page profiles">
      <section className="me is-friend">
        <Avatar profile={p.profile} size={112} className="me-avatar" />
        <div className="me-main">
          <div className="me-eyebrow">Shared profile · imported {relativeTime(p.importedAt)}</div>
          <h2 className="me-name display">{p.profile.name}</h2>
          {p.profile.tagline && <p className="me-tagline">“{p.profile.tagline}”</p>}
          <Stats library={p.library.length} watched={p.history.length} read={p.reading.length} favorites={p.profile.favorites.length} />
          <div className="me-actions">
            {missing.length > 0 && (
              <Button variant="primary" icon="plus" onClick={() => void addAll()}>
                Add {missing.length} to my Planning
              </Button>
            )}
            <Menu
              width={220}
              items={[{ key: 'remove', label: 'Remove this profile', icon: 'trash', danger: true, onSelect: () => void remove() }]}
              trigger={({ toggle, open, id: menuId }) => (
                <Button variant="ghost" icon="more" aria-expanded={open} aria-controls={menuId} onClick={toggle}>
                  More
                </Button>
              )}
            />
          </div>
        </div>
      </section>

      <div className="prof-section">
        <Tabs
          label="Their lists"
          value={current}
          onChange={setTab}
          options={[
            { value: 'favorites', label: 'Favourites', count: lists.favorites.length },
            { value: 'watched', label: 'Watched', count: lists.watched.length },
            { value: 'library', label: 'Library', count: lists.library.length },
            { value: 'reading', label: 'Reading', count: lists.reading.length },
          ]}
        />
        {items.length === 0 ? (
          <EmptyState compact icon="library" title="Nothing here" body={`${p.profile.name} hasn’t shared anything in this list.`} />
        ) : (
          <div className="poster-grid prof-grid">
            {items.map(({ media, meta }) => (
              <div key={media.id} className="prof-item">
                <PosterCard media={fromSnapshot(media)} meta={meta ?? undefined} />
                {statusOf(media.id) ? (
                  <span className="prof-have">
                    <Icon name="check" size={13} stroke={2.2} /> In your library
                  </span>
                ) : (
                  <button type="button" className="prof-add" onClick={() => void add(media)}>
                    <Icon name="plus" size={13} stroke={2.2} /> Add to mine
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
