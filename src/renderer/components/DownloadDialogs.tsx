import { useEffect, useState } from 'react';
import type { Audio, Chapter, DownloadRequest, Episode, MediaSnapshot, QualityPref } from '../../shared/types';
import { navigate } from '../lib/router';
import { useApp } from '../lib/store';
import { Button, Segmented } from './Controls';
import { Modal } from './Modal';

const QUALITIES: { value: QualityPref; label: string }[] = [
  { value: 'best', label: 'Best' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p · smallest' },
];

// Rough sizes for a 24-minute episode, to set expectations before a big batch.
const EST_MB: Record<QualityPref, number> = { best: 420, '1080': 420, '720': 260, '480': 150 };

interface EpisodeDialogProps {
  open: boolean;
  onClose: () => void;
  media: MediaSnapshot;
  episodes: Episode[];
  initial?: { from: number; to: number };
  defaultAudio: Audio;
}

export function EpisodeDownloadDialog({ open, onClose, media, episodes, initial, defaultAudio }: EpisodeDialogProps) {
  const { settings, toast } = useApp();
  const first = episodes[0]?.number ?? 1;
  const last = episodes[episodes.length - 1]?.number ?? 1;
  const [from, setFrom] = useState(initial?.from ?? first);
  const [to, setTo] = useState(initial?.to ?? last);
  const [audio, setAudio] = useState<Audio>(defaultAudio);
  const [quality, setQuality] = useState<QualityPref>(settings.quality);
  const [subTrack, setSubTrack] = useState<string>('default');
  // Opened from the player on one episode: offer "just this one" first.
  const single = initial && initial.from === initial.to ? initial.from : null;
  const [scope, setScope] = useState<'this' | 'range' | 'all'>(single !== null ? 'this' : 'range');
  const hasDub = episodes.some((e) => e.dubUrl);

  useEffect(() => {
    if (!open) return;
    setFrom(initial?.from ?? first);
    setTo(initial?.to ?? last);
    setScope(initial && initial.from === initial.to ? 'this' : 'range');
    setAudio(defaultAudio === 'dub' && hasDub ? 'dub' : 'sub');
    setQuality(settings.quality);
  }, [open, initial?.from, initial?.to, first, last, defaultAudio, hasDub, settings.quality]);

  const lo = scope === 'all' ? first : scope === 'this' && single !== null ? single : Math.min(from, to);
  const hi = scope === 'all' ? last : scope === 'this' && single !== null ? single : Math.max(from, to);
  const chosen = episodes.filter((e) => e.number >= lo && e.number <= hi);
  const playable = chosen.filter((e) => (audio === 'dub' ? e.dubUrl : e.subUrl));
  const skipped = chosen.length - playable.length;
  const isMovie = media.format === 'MOVIE';

  const start = async () => {
    const reqs: DownloadRequest[] = playable.map((e) => ({
      kind: 'episode',
      media,
      episode: e.number,
      episodeTitle: e.title,
      audio,
      embedUrl: (audio === 'dub' ? e.dubUrl : e.subUrl)!,
      quality,
      subtitleLabel: subTrack === 'none' ? 'none' : subTrack === 'default' ? (settings.subtitleLanguage || 'English') : subTrack,
    }));
    const added = await window.playzanime.downloads.startMany(reqs);
    onClose();
    toast(added ? `Queued ${added} ${isMovie ? 'movie' : added === 1 ? 'episode' : 'episodes'}` : 'Those are already downloading', {
      action: { label: 'View', run: () => navigate('/downloads') },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isMovie ? `Download ${media.title}` : scope === 'this' && single !== null ? `Download episode ${single}` : 'Download episodes'}
      width={600}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="downloads" disabled={!playable.length} onClick={() => void start()}>
            {isMovie ? 'Download movie' : `Download ${playable.length} ${playable.length === 1 ? 'episode' : 'episodes'}`}
          </Button>
        </>
      }
    >
      {!isMovie && episodes.length > 1 && (
        <div className="field">
          <span className="field-label">Which episodes</span>
          <Segmented
            label="Which episodes"
            value={scope}
            onChange={setScope}
            options={[
              ...(single !== null ? [{ value: 'this' as const, label: `Only episode ${single}` }] : []),
              { value: 'range' as const, label: 'From one episode to another' },
              { value: 'all' as const, label: `All ${episodes.length}` },
            ]}
          />
          {scope === 'range' && (
            <div className="field-row" style={{ marginTop: 10 }}>
              <span className="faint">Episode</span>
              <input className="input is-num" type="number" min={first} max={last} value={from} aria-label="From episode" onChange={(e) => setFrom(Number(e.target.value) || first)} />
              <span className="faint">to episode</span>
              <input className="input is-num" type="number" min={first} max={last} value={to} aria-label="To episode" onChange={(e) => setTo(Number(e.target.value) || last)} />
            </div>
          )}
          <span className="field-note">
            {chosen.length === 1 ? `Episode ${lo}.` : `Episodes ${lo} to ${hi}: ${chosen.length} in total.`} {settings.maxDownloads ?? 3} download at a time; change that on the Downloads page.
          </span>
        </div>
      )}
      <div className="field">
        <span className="field-label">Audio</span>
        <Segmented
          label="Audio"
          value={audio}
          onChange={setAudio}
          options={[
            { value: 'sub', label: 'Japanese, subtitled' },
            { value: 'dub', label: 'English dub', disabled: !hasDub, title: hasDub ? undefined : 'No dub for this show' },
          ]}
        />
      </div>
      <div className="field">
        <span className="field-label">Subtitles to Include</span>
        <Segmented
          label="Subtitles"
          value={subTrack}
          onChange={setSubTrack}
          options={[
            { value: 'default', label: `${settings.subtitleLanguage || 'English'} (Default)` },
            { value: 'Spanish', label: 'Spanish' },
            { value: 'French', label: 'French' },
            { value: 'none', label: 'None (Audio only)' },
          ]}
        />
        <span className="field-note">
          Subtitles are packed directly into the MP4 (works with both Dub and Sub).
        </span>
      </div>
      <div className="field">
        <span className="field-label">Quality</span>
        <Segmented label="Quality" value={quality} onChange={setQuality} options={QUALITIES} />
        <span className="field-note">If a size isn’t offered by the source, the closest lower one is used.</span>
      </div>
      <p className="field-note" style={{ marginTop: 18 }}>
        {audio === 'sub' ? `${settings.subtitleLanguage} subtitles are packed into the video. ` : ''}
        Saved to <strong>{settings.animeDir}</strong>. About {Math.round((EST_MB[quality] * Math.max(1, playable.length) * (isMovie ? 4 : 1)) / 100) / 10} GB in total.
        {skipped > 0 && ` ${skipped} episode${skipped === 1 ? ' has' : 's have'} no ${audio} version and will be skipped.`}
      </p>
    </Modal>
  );
}

interface ChapterDialogProps {
  open: boolean;
  onClose: () => void;
  media: MediaSnapshot;
  chapters: Chapter[];
  unread: Chapter[];
  /** The chapter you're reading, if any: "from here on" starts there. */
  current?: string | null;
}

type ChapterScope = 'here' | 'unread' | 'range' | 'all';
const num = (c: Chapter) => (c.number ? parseFloat(c.number) : NaN);

export function ChapterDownloadDialog({ open, onClose, media, chapters, unread, current }: ChapterDialogProps) {
  const { settings, toast } = useApp();
  const readable = chapters.filter((c) => !c.externalUrl);
  const numbered = readable.filter((c) => Number.isFinite(num(c)));
  const firstNum = numbered.length ? Math.min(...numbered.map(num)) : 1;
  const lastNum = numbered.length ? Math.max(...numbered.map(num)) : 1;
  const here = current ? readable.find((c) => c.id === current) : undefined;
  const hereNum = here ? num(here) : NaN;

  const [scope, setScope] = useState<ChapterScope>(Number.isFinite(hereNum) ? 'here' : 'unread');
  const [from, setFrom] = useState(firstNum);
  const [to, setTo] = useState(lastNum);
  useEffect(() => {
    if (!open) return;
    setScope(Number.isFinite(hereNum) ? 'here' : 'unread');
    setFrom(Number.isFinite(hereNum) ? hereNum : firstNum);
    setTo(lastNum);
  }, [open, hereNum, firstNum, lastNum]);

  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const pick =
    scope === 'all'
      ? readable
      : scope === 'unread'
        ? unread.filter((c) => !c.externalUrl)
        : scope === 'here'
          ? numbered.filter((c) => num(c) >= hereNum)
          : numbered.filter((c) => num(c) >= lo && num(c) <= hi);

  const start = async () => {
    const added = await window.playzanime.downloads.startMany(pick.map((chapter) => ({ kind: 'chapter', media, chapter })));
    onClose();
    toast(added ? `Queued ${added.toLocaleString()} ${added === 1 ? 'chapter' : 'chapters'}` : 'Those are already downloading', {
      action: { label: 'View', run: () => navigate('/downloads') },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Download chapters"
      width={600}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="downloads" disabled={!pick.length} onClick={() => void start()}>
            Download {pick.length.toLocaleString()} {pick.length === 1 ? 'chapter' : 'chapters'}
          </Button>
        </>
      }
    >
      <div className="field">
        <span className="field-label">Which chapters</span>
        <Segmented
          label="Which chapters"
          value={scope}
          onChange={setScope}
          options={[
            ...(Number.isFinite(hereNum) ? [{ value: 'here' as const, label: `From chapter ${here?.number} on` }] : []),
            { value: 'unread' as const, label: `Unread (${unread.filter((c) => !c.externalUrl).length.toLocaleString()})` },
            { value: 'range' as const, label: 'A range' },
            { value: 'all' as const, label: `All (${readable.length.toLocaleString()})` },
          ]}
        />
        {scope === 'range' && (
          <div className="field-row" style={{ marginTop: 10 }}>
            <span className="faint">Chapter</span>
            <input className="input is-num" type="number" min={firstNum} max={lastNum} value={from} aria-label="From chapter" onChange={(e) => setFrom(Number(e.target.value) || firstNum)} />
            <span className="faint">to chapter</span>
            <input className="input is-num" type="number" min={firstNum} max={lastNum} value={to} aria-label="To chapter" onChange={(e) => setTo(Number(e.target.value) || lastNum)} />
            {[10, 50, 100].map((n) => (
              <Button key={n} variant="quiet" size="sm" onClick={() => setTo(Math.min(lastNum, lo + n - 1))}>
                Next {n}
              </Button>
            ))}
          </div>
        )}
        <span className="field-note">
          {pick.length ? `${pick.length.toLocaleString()} ${pick.length === 1 ? 'chapter' : 'chapters'}` : 'No chapters'}
          {scope === 'range' ? ` between chapter ${lo} and ${hi}` : ''}. {settings.maxDownloads ?? 3} download at a time; change that on the Downloads page.
        </span>
      </div>
      <p className="field-note" style={{ marginTop: 18 }}>
        Each chapter becomes a .cbz file in <strong>{settings.mangaDir}</strong>, readable in any comic reader. A single chapter downloads from the button on its row.
      </p>
    </Modal>
  );
}
