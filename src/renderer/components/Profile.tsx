import { useMemo, useRef, useState } from 'react';
import type { MediaSnapshot, Profile } from '../../shared/types';
import { useApp } from '../lib/store';
import { Button, IconButton } from './Controls';
import { Icon } from './Icon';
import { Img } from './Media';
import './profile.css';

/*
 * A profile's picture is either the photo someone chose or, until then, a seal
 * with their initial carved into it: the same hanko idea as the app mark.
 */

// The five accent inks, so friends' seals are told apart at a glance.
const SEAL_INKS = ['#f0532c', '#9dbb5c', '#6f8fe6', '#f3aa36', '#ee83a1'];

function inkFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SEAL_INKS[h % SEAL_INKS.length];
}

export function Avatar({ profile, size = 40, own = false, className = '' }: { profile: Pick<Profile, 'id' | 'name' | 'avatar'> | null; size?: number; own?: boolean; className?: string }) {
  const initial = (profile?.name.trim()[0] ?? '').toUpperCase();
  const style = { width: size, height: size, fontSize: size * 0.52, ['--seal' as string]: own ? 'var(--accent)' : inkFor(profile?.id ?? '') };
  if (profile?.avatar) {
    return (
      <span className={`avatar ${className}`} style={style}>
        <img src={profile.avatar} alt="" draggable={false} />
      </span>
    );
  }
  return (
    <span className={`avatar is-seal ${className}`} style={style} aria-hidden="true">
      {initial || <Icon name="profile" size={size * 0.55} />}
    </span>
  );
}

/** Crops the chosen picture to a square and shrinks it, so profiles stay small enough to share. */
export async function fileToAvatar(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Pick a PNG, JPEG, WebP or GIF picture.');
  if (file.size > 25 * 1024 * 1024) throw new Error('That picture is too large.');
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  bitmap.close();
  return canvas.toDataURL('image/webp', 0.88);
}

export function blankProfile(): Profile {
  return { id: crypto.randomUUID(), name: '', avatar: null, tagline: null, favorites: [], createdAt: Date.now() };
}

const MAX_FAVORITES = 12;

/**
 * Name, picture, a line about yourself and up to twelve favourites.
 * Used by first-run onboarding and by the Profiles page.
 */
export function ProfileFields({ value, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  const { library, history, reading, toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);

  // Anything the person has touched is a candidate favourite.
  const candidates = useMemo(() => {
    const seen = new Map<number, MediaSnapshot>();
    for (const m of [...library.map((e) => e.media), ...history.map((h) => h.media), ...reading.map((r) => r.media)]) if (!seen.has(m.id)) seen.set(m.id, m);
    return [...seen.values()];
  }, [library, history, reading]);

  const choosePicture = async (file: File | undefined) => {
    if (!file) return;
    try {
      onChange({ ...value, avatar: await fileToAvatar(file) });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That picture couldn’t be used.', { tone: 'error' });
    }
  };

  const isFav = (id: number) => value.favorites.some((f) => f.id === id);
  const toggleFav = (m: MediaSnapshot) => {
    if (isFav(m.id)) onChange({ ...value, favorites: value.favorites.filter((f) => f.id !== m.id) });
    else if (value.favorites.length < MAX_FAVORITES) onChange({ ...value, favorites: [...value.favorites, m] });
    else toast(`Up to ${MAX_FAVORITES} favourites.`);
  };

  return (
    <div className="pf">
      <div className="pf-identity">
        <button type="button" className="pf-picture" onClick={() => fileRef.current?.click()} aria-label="Choose a profile picture">
          <Avatar profile={{ ...value, name: value.name || '?' }} size={104} own />
          <span className="pf-picture-hint">
            <Icon name="image" size={16} />
            {value.avatar ? 'Change' : 'Add picture'}
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void choosePicture(e.target.files?.[0])} />
        <div className="pf-text">
          <label className="field">
            <span className="field-label">Name</span>
            <input className="input" value={value.name} maxLength={40} placeholder="What should friends see?" onChange={(e) => onChange({ ...value, name: e.target.value })} autoFocus />
          </label>
          <label className="field">
            <span className="field-label">About you</span>
            <input
              className="input"
              value={value.tagline ?? ''}
              maxLength={120}
              placeholder="Mostly seinen, the odd shoujo, zero filler."
              onChange={(e) => onChange({ ...value, tagline: e.target.value || null })}
            />
          </label>
          {value.avatar && (
            <button type="button" className="pf-remove" onClick={() => onChange({ ...value, avatar: null })}>
              Use my seal instead of a picture
            </button>
          )}
        </div>
      </div>

      <div className="pf-favs">
        <div className="pf-favs-head">
          <span className="field-label">
            Favourites <span className="faint num">{value.favorites.length}/{MAX_FAVORITES}</span>
          </span>
          {candidates.length > 0 && (
            <Button variant="quiet" size="sm" icon={picking ? 'check' : 'plus'} onClick={() => setPicking((p) => !p)}>
              {picking ? 'Done' : 'Choose'}
            </Button>
          )}
        </div>
        {picking ? (
          <div className="pf-fav-grid">
            {candidates.map((m) => (
              <button key={m.id} type="button" className={`pf-fav ${isFav(m.id) ? 'is-on' : ''}`} onClick={() => toggleFav(m)} title={m.title} aria-pressed={isFav(m.id)}>
                <Img src={m.cover} color={m.color} />
                {isFav(m.id) && (
                  <span className="pf-fav-check">
                    <Icon name="check" size={14} stroke={2.4} />
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : value.favorites.length ? (
          <div className="pf-fav-row">
            {value.favorites.map((m) => (
              <div key={m.id} className="pf-fav is-on" title={m.title}>
                <Img src={m.cover} color={m.color} />
                <IconButton icon="close" size={13} label={`Remove ${m.title}`} className="pf-fav-x" onClick={() => toggleFav(m)} />
              </div>
            ))}
          </div>
        ) : (
          <p className="pf-empty">
            {candidates.length
              ? 'Pick the shows and series you’d hand a friend first.'
              : 'Once you’ve watched or saved a few things, you can pin favourites here.'}
          </p>
        )}
      </div>
    </div>
  );
}
