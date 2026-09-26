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
  const hasDub = episodes.some((e) => e.dubUrl);

  useEffect(() => {
    if (!open) return;
    setFrom(initial?.from ?? first);
    setTo(initial?.to ?? last);
    setAudio(defaultAudio === 'dub' && hasDub ? 'dub' : 'sub');
    setQuality(settings.quality);
  }, [open, initial?.from, initial?.to, first, last, defaultAudio, hasDub, settings.quality]);

  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
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
      title={isMovie ? `Download ${media.title}` : `Download episodes`}
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
          <span className="field-label">Episodes</span>
          <div className="field-row">
            <input className="input is-num" type="number" min={first} max={last} value={from} aria-label="From episode" onChange={(e) => setFrom(Number(e.target.value) || first)} />
            <span className="faint">to</span>
            <input className="input is-num" type="number" min={first} max={last} value={to} aria-label="To episode" onChange={(e) => setTo(Number(e.target.value) || last)} />
            <Button variant="quiet" size="sm" onClick={() => (setFrom(first), setTo(last))}>
              All {episodes.length}
            </Button>
          </div>
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
}

export function ChapterDownloadDialog({ open, onClose, media, chapters, unread }: ChapterDialogProps) {
  const { settings, toast } = useApp();
  const readable = chapters.filter((c) => !c.externalUrl);
  const [scope, setScope] = useState<'unread' | 'next10' | 'all'>('unread');

  const pick = scope === 'all' ? readable : scope === 'unread' ? unread.filter((c) => !c.externalUrl) : unread.filter((c) => !c.externalUrl).slice(0, 10);

  const start = async () => {
    const added = await window.playzanime.downloads.startMany(pick.map((chapter) => ({ kind: 'chapter', media, chapter })));
    onClose();
    toast(added ? `Queued ${added} ${added === 1 ? 'chapter' : 'chapters'}` : 'Those are already downloading', {
      action: { label: 'View', run: () => navigate('/downloads') },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Download chapters"
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="downloads" disabled={!pick.length} onClick={() => void start()}>
            Download {pick.length} {pick.length === 1 ? 'chapter' : 'chapters'}
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
            { value: 'unread', label: `Unread (${unread.filter((c) => !c.externalUrl).length})` },
            { value: 'next10', label: 'Next 10 unread' },
            { value: 'all', label: `All (${readable.length})` },
          ]}
        />
      </div>
      <p className="field-note" style={{ marginTop: 18 }}>
        Each chapter becomes a .cbz file in <strong>{settings.mangaDir}</strong>, readable in any comic reader.
      </p>
    </Modal>
  );
}
