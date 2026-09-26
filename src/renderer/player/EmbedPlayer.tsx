import { useEffect, useRef } from 'react';
import './player.css';

interface EmbedPlayerProps {
  url: string;
  startAt: number;
  onProgress: (position: number, duration: number) => void;
}

/**
 * The provider's own player in an iframe. Pop-ups and redirects are blocked by
 * the main process; playback position comes from the postMessage events these
 * players broadcast.
 */
export function EmbedPlayer({ url, startAt, onProgress }: EmbedPlayerProps) {
  const last = useRef({ position: startAt, duration: 0, sent: 0 });
  const report = useRef(onProgress);
  report.current = onProgress;
  const src = startAt > 5 ? `${url}${url.includes('?') ? '&' : '?'}time=${Math.floor(startAt)}` : url;

  useEffect(() => {
    const origin = new URL(url).origin;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin) return;
      let data: unknown = e.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (!data || typeof data !== 'object') return;
      const d = data as Record<string, unknown> & { data?: Record<string, unknown> };
      const inner = d.data && typeof d.data === 'object' ? d.data : {};
      const pos = [d.time, d.currentTime, d.position, inner.time, inner.currentTime].find((v) => typeof v === 'number' && v > 0) as number | undefined;
      const dur = [d.duration, inner.duration].find((v) => typeof v === 'number' && v > 0) as number | undefined;
      if (pos) last.current.position = pos;
      if (dur) last.current.duration = dur;
      const now = Date.now();
      if (last.current.duration && now - last.current.sent > 5000) {
        last.current.sent = now;
        report.current(last.current.position, last.current.duration);
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (last.current.duration) report.current(last.current.position, last.current.duration);
    };
  }, [url]);

  return (
    <iframe
      key={url}
      className="embed-frame"
      src={src}
      title="Episode player"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowFullScreen
      referrerPolicy="origin"
    />
  );
}
