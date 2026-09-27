import { useState, type ReactNode } from 'react';
import { MANGA_PROVIDERS, type AccentKey, type ProviderHealth, type Settings as SettingsT } from '../../shared/types';
import { Button, Segmented, Select, Switch } from '../components/Controls';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { Modal } from '../components/Modal';
import { useLoader } from '../lib/data';
import { useApp } from '../lib/store';
import './settings.css';

const api = () => window.playzanime;

// The policies live on the PlayzAnime website; until it has its own domain, the GitHub page links there.
const LEGAL_URL = 'https://github.com/PlayzAe/playz_anime/blob/main/LEGAL.md';

const ACCENTS: { key: AccentKey; name: string; kanji: string; color: string }[] = [
  { key: 'shu', name: 'Shu', kanji: '朱', color: '#f0532c' },
  { key: 'yamabuki', name: 'Yamabuki', kanji: '山吹', color: '#f3aa36' },
  { key: 'matcha', name: 'Matcha', kanji: '抹茶', color: '#9dbb5c' },
  { key: 'ai', name: 'Ai', kanji: '藍', color: '#6f8fe6' },
  { key: 'sakura', name: 'Sakura', kanji: '桜', color: '#ee83a1' },
];

const LANGUAGES = ['English', 'Spanish', 'Portuguese', 'French', 'German', 'Italian', 'Russian', 'Arabic', 'Indonesian'].map((l) => ({ value: l, label: l }));

const SHORTCUTS: [string, string][] = [
  ['Ctrl K  or  /', 'Search anime and manga'],
  ['Alt ←  /  Alt →', 'Back and forward'],
  ['Space  or  K', 'Play / pause'],
  ['J  /  L', 'Back / forward 10 seconds'],
  ['←  /  →', 'Back / forward 5 seconds'],
  ['↑  /  ↓', 'Volume'],
  ['S', 'Skip intro'],
  ['N  /  P', 'Next / previous episode'],
  ['C', 'Cycle subtitles'],
  ['F', 'Full screen'],
  ['T', 'Theater mode'],
  ['0 – 9', 'Jump to 0% – 90%'],
  ['[  /  ]', 'Previous / next chapter (reader)'],
  ['M', 'Scroll or page mode (reader)'],
  ['F11', 'Full-screen window'],
];

export function Settings() {
  const { settings, updateSettings, toast, clearAllHistory } = useApp();
  const info = useLoader('appinfo', () => api().app.info(), Infinity);
  const [confirm, setConfirm] = useState(false);
  const set = <K extends keyof SettingsT>(key: K, value: SettingsT[K]) => void updateSettings({ [key]: value } as Partial<SettingsT>);

  const chooseDir = async (kind: 'anime' | 'manga') => {
    const next = await api().settings.chooseDir(kind);
    if (next) toast('Download folder updated');
  };

  return (
    <div className="page settings">
      <div className="page-head">
        <h1 className="page-title display">Settings</h1>
        <p className="page-sub">Changes save as you make them.</p>
      </div>

      <div className="settings-body">
        <Group title="Look">
          <Row title="Accent" note="Used for the play button and progress bars. Named after traditional Japanese colours.">
            <div className="swatches" role="radiogroup" aria-label="Accent colour">
              {ACCENTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  role="radio"
                  aria-checked={settings.accent === a.key}
                  className={`swatch ${settings.accent === a.key ? 'is-on' : ''}`}
                  onClick={() => set('accent', a.key)}
                  title={a.name}
                >
                  <span className="swatch-color" style={{ background: a.color }} />
                  <span className="swatch-kanji jp">{a.kanji}</span>
                  <span className="swatch-name">{a.name}</span>
                </button>
              ))}
            </div>
          </Row>
          <Row title="Titles" note="Which name to show first.">
            <Segmented
              label="Title language"
              value={settings.titleLanguage}
              onChange={(v) => set('titleLanguage', v)}
              options={[
                { value: 'english', label: 'English' },
                { value: 'romaji', label: 'Romaji' },
              ]}
            />
          </Row>
          <Row title="Japanese titles" note="Show the original title set vertically beside the artwork.">
            <Switch checked={settings.showNativeTitles} onChange={(v) => set('showNativeTitles', v)} label="Show Japanese titles" />
          </Row>
        </Group>

        <Group title="Watching">
          <Row title="Player" note="PlayzAnime’s player has keyboard shortcuts, skip intro and no ads. The embed player is the source’s own, kept as a fallback.">
            <Segmented
              label="Default player"
              value={settings.player}
              onChange={(v) => set('player', v)}
              options={[
                { value: 'direct', label: 'PlayzAnime' },
                { value: 'embed', label: 'Embed' },
              ]}
            />
          </Row>
          <Row title="Prefer English dub" note="Starts dubbed when a dub exists.">
            <Switch checked={settings.preferDub} onChange={(v) => set('preferDub', v)} label="Prefer English dub" />
          </Row>
          <Row title="Subtitle language" note="Picked automatically when the source has it.">
            <Select label="Subtitle language" value={settings.subtitleLanguage} onChange={(v) => set('subtitleLanguage', v)} options={LANGUAGES} width={180} />
          </Row>
          <Row title="Autoplay next episode" note="Counts down while the credits roll.">
            <Switch checked={settings.autoplayNext} onChange={(v) => set('autoplayNext', v)} label="Autoplay next episode" />
          </Row>
          <Row title="Skip intros automatically" note="Only for episodes where the source marks the opening.">
            <Switch checked={settings.autoSkipIntro} onChange={(v) => set('autoSkipIntro', v)} label="Skip intros automatically" />
          </Row>
        </Group>

        <Group title="Reading">
          <Row title="Reading mode" note="Press M in the reader to switch.">
            <Segmented
              label="Reading mode"
              value={settings.readerMode}
              onChange={(v) => set('readerMode', v)}
              options={[
                { value: 'vertical', label: 'Scroll' },
                { value: 'paged', label: 'Pages' },
              ]}
            />
          </Row>
          <Row title="Page direction" note="For page mode. Japanese manga reads right to left.">
            <Segmented
              label="Page direction"
              value={settings.readerDirection}
              onChange={(v) => set('readerDirection', v)}
              options={[
                { value: 'rtl', label: 'Right to left' },
                { value: 'ltr', label: 'Left to right' },
              ]}
            />
          </Row>
          <Row title="Manga source" note="Auto checks every source for each title and reads from the one that’s furthest along, skipping any that are down.">
            <Segmented
              label="Manga source"
              value={settings.mangaProvider}
              onChange={(v) => set('mangaProvider', v)}
              options={[{ value: 'auto', label: 'Auto' }, ...MANGA_PROVIDERS.map((p) => ({ value: p.id, label: p.name, title: p.note }))]}
            />
          </Row>
          <SourceHealth />
        </Group>

        <Group title="Manga & Manhwa Extensions (55 Sources)">
          <ExtensionsManager />
        </Group>

        <Group title="Downloads">
          <Row title="Anime folder" note={settings.animeDir}>
            <div className="row-buttons">
              <Button variant="quiet" size="sm" icon="folder" onClick={() => void api().app.openDir('anime')}>
                Open
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void chooseDir('anime')}>
                Change
              </Button>
            </div>
          </Row>
          <Row title="Manga folder" note={settings.mangaDir}>
            <div className="row-buttons">
              <Button variant="quiet" size="sm" icon="folder" onClick={() => void api().app.openDir('manga')}>
                Open
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void chooseDir('manga')}>
                Change
              </Button>
            </div>
          </Row>
          <FolderGuardRow />
          <Row title="Episode quality" note="Used for new downloads. Lower quality saves disk space.">
            <Select
              label="Episode quality"
              value={settings.quality}
              onChange={(v) => set('quality', v)}
              width={180}
              options={[
                { value: 'best', label: 'Best available' },
                { value: '1080', label: 'Up to 1080p' },
                { value: '720', label: 'Up to 720p' },
                { value: '480', label: 'Up to 480p' },
              ]}
            />
          </Row>
          <Row title="Notify when finished" note="A Windows notification when the queue empties.">
            <Switch checked={settings.notifyDownloads} onChange={(v) => set('notifyDownloads', v)} label="Notify when downloads finish" />
          </Row>
        </Group>

        <Group title="Network & privacy">
          <Row title="Data saver" note="For hotspots and capped plans: smaller video buffers, 720p at most, no pre-loading of the next episode, and compressed manga pages where the source offers them.">
            <Switch checked={settings.dataSaver} onChange={(v) => set('dataSaver', v)} label="Data saver" />
          </Row>
          <Row title="Block ads and pop-ups" note="Filters ad and tracker requests inside embedded players. Pop-up windows are always blocked.">
            <Switch checked={settings.adblock} onChange={(v) => set('adblock', v)} label="Block ads" />
          </Row>
          <Row title="Hide adult titles" note="Leaves 18+ entries out of every list and search.">
            <Switch checked={settings.hideAdult} onChange={(v) => set('hideAdult', v)} label="Hide adult titles" />
          </Row>
        </Group>

        <Group title="Your data">
          <Row title="Clear cached lists" note="Forces fresh data from AniList and the sources on next load.">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void api()
                  .app.clearCache()
                  .then(() => toast('Cache cleared'))
              }
            >
              Clear cache
            </Button>
          </Row>
          <Row title="Watch and reading history" note="Resume points, watched episodes and read chapters. Library lists stay.">
            <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
              Clear history
            </Button>
          </Row>
        </Group>

        <Group title="Keyboard">
          <dl className="shortcuts">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys} className="shortcut">
                <dt>
                  {keys.split(/\s{2}/).map((k, i) =>
                    ['or', '/'].includes(k) ? (
                      <span key={i} className="faint">
                        {' '}
                        {k}{' '}
                      </span>
                    ) : (
                      <kbd key={i}>{k}</kbd>
                    ),
                  )}
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </Group>

        <Group title="Support">
          <div className="support">
            <p>
              PlayzAnime is free, has no ads and never will. If it earns a place on your desktop, a star or a follow on GitHub keeps it going.
            </p>
            <Button variant="primary" icon="heart" onClick={() => void api().app.openExternal('https://github.com/PlayzAe')}>
              github.com/PlayzAe
            </Button>
          </div>
        </Group>

        <Group title="Documentation & Architecture">
          <div className="doc-links-grid">
            <div className="doc-link-card">
              <div className="doc-link-header">
                <Icon name="layers" size={16} />
                <strong>Multi-Source Engine Architecture</strong>
              </div>
              <p>
                Learn how PlayzAnime indexes 55+ Mihon & Tachiyomi scanlation extensions, automatically detects Cloudflare WAF blocks, and dynamically switches sources.
              </p>
              <Button
                variant="ghost"
                size="sm"
                icon="external"
                onClick={() => void api().app.openExternal('https://github.com/PlayzAe/playz_anime#multi-source-engine--extensions')}
              >
                Read Engine Docs
              </Button>
            </div>

            <div className="doc-link-card">
              <div className="doc-link-header">
                <Icon name="shield" size={16} />
                <strong>Legal, Terms & Privacy Policy</strong>
              </div>
              <p>
                Compliance details, DMCA takedown procedure, zero-log privacy policy, and open-source license information.
              </p>
              <Button
                variant="ghost"
                size="sm"
                icon="external"
                onClick={() => void api().app.openExternal('https://github.com/PlayzAe/playz_anime/blob/main/LEGAL.md')}
              >
                View Legal Document
              </Button>
            </div>

            <div className="doc-link-card">
              <div className="doc-link-header">
                <Icon name="tv" size={16} />
                <strong>Direct Player & HLS Relay Protocol</strong>
              </div>
              <p>
                Technical overview of our stream resolver, in-player subtitle customizer, and low-latency proxy design.
              </p>
              <Button
                variant="ghost"
                size="sm"
                icon="external"
                onClick={() => void api().app.openExternal('https://github.com/PlayzAe/playz_anime/blob/main/CONTRACT.md')}
              >
                API & Stream Contract
              </Button>
            </div>

            <div className="doc-link-card">
              <div className="doc-link-header">
                <Icon name="code" size={16} />
                <strong>Official GitHub Repositories</strong>
              </div>
              <p>
                Source code repositories for Desktop Electron app releases, Web server hosting, and Landing page.
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => void api().app.openExternal('https://github.com/PlayzAe/playz_anime_desktopapp')}
                >
                  Desktop Repo
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => void api().app.openExternal('https://github.com/PlayzAe/playz_anime')}
                >
                  Web Repo
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => void api().app.openExternal('https://github.com/PlayzAe/playz_anime_landingpage')}
                >
                  Landing Repo
                </Button>
              </div>
            </div>
          </div>
        </Group>

        <Group title="About">
          <div className="about">
            <Logo size={56} />
            <div>
              <p className="about-name">PlayzAnime {info.data?.version}</p>
              <p className="faint num">
                Electron {info.data?.electron} · Chromium {info.data?.chrome?.split('.')[0]}
              </p>
              <p className="about-credits">
                Titles, artwork and schedules come from AniList. Chapters come from MangaDex, WeebCentral, Flame Comics and MangaPill, and episodes from third-party hosts. PlayzAnime
                doesn’t host, upload or store any video or pages; its server only forwards requests as they happen. It isn’t affiliated with any source, studio, publisher or streaming
                service.
              </p>
              <p className="about-credits">
                By using PlayzAnime you agree to its{' '}
                <a href={LEGAL_URL} target="_blank" rel="noopener noreferrer">
                  terms, copyright policy and privacy policy
                </a>
                .
              </p>
              {info.data && (
                <p className="faint about-data" title={info.data.userData}>
                  Settings and history live in {info.data.userData}
                </p>
              )}
            </div>
          </div>
        </Group>
      </div>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Clear all history?"
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirm(false)}>
              Keep it
            </Button>
            <Button
              variant="primary"
              icon="trash"
              onClick={() => {
                void clearAllHistory();
                setConfirm(false);
                toast('History cleared');
              }}
            >
              Clear history
            </Button>
          </>
        }
      >
        <p className="muted">Resume points, watched episodes and read chapters are removed. Your library lists and downloaded files stay.</p>
      </Modal>
    </div>
  );
}

/** Windows Defender "Controlled folder access": what it's doing to our folders, and a way through. */
function FolderGuardRow() {
  const { toast, updateSettings } = useApp();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const status = useLoader(`setup-status:${tick}`, () => api().setup.status(), 60_000);
  const s = status.data;
  if (!s || s.guard === 'off' || s.guard === 'unknown') return null;

  const blocked = s.folderIssues.length > 0;
  const note =
    s.guard === 'audit'
      ? 'Controlled folder access is in audit mode: Windows logs writes but blocks nothing.'
      : blocked
        ? `Controlled folder access is on and blocking ${s.folderIssues.map((i) => i.wanted).join(' and ')}. Downloads are going to your Downloads folder instead.`
        : 'Controlled folder access is on. Your download folders are writable.';

  const allow = async () => {
    setBusy(true);
    try {
      const { approved, status: next } = await api().setup.allowFolders();
      if (!approved) toast('Windows didn’t allow it.');
      else if (next.folderIssues.length) toast('Still blocked. Downloads keep using your Downloads folder.', { tone: 'error' });
      else {
        toast('PlayzAnime can now save to your chosen folders.');
        // The settings file already has the folders back; refresh our copy of them.
        await updateSettings({});
      }
    } finally {
      setBusy(false);
      setTick((n) => n + 1);
    }
  };

  return (
    <Row title="Windows folder protection" note={note}>
      {s.guard === 'on' && (
        <Button variant={blocked ? 'primary' : 'ghost'} size="sm" icon="shield" disabled={busy} onClick={() => void allow()}>
          {busy ? 'Waiting for Windows…' : 'Allow PlayzAnime'}
        </Button>
      )}
    </Row>
  );
}

/** Which chapter sources answer right now, and how quickly. */
function SourceHealth() {
  const [force, setForce] = useState(0);
  const health = useLoader(`manga-health:${force}`, () => api().manga.health(force > 0), 60_000);
  const byId = new Map<string, ProviderHealth>((health.data ?? []).map((h) => [h.provider, h]));
  return (
    <div className="sources">
      {MANGA_PROVIDERS.map((p) => {
        const h = byId.get(p.id);
        const state = !h ? 'checking' : h.ok ? (h.ms > 4000 ? 'slow' : 'up') : 'down';
        const isCloudflare = h?.error?.includes('403');
        const stateLabel =
          state === 'checking'
            ? 'Checking…'
            : state === 'down'
              ? isCloudflare
                ? 'Blocked (Cloudflare 403)'
                : 'Unreachable'
              : `${(h!.ms / 1000).toFixed(1)} s`;
        const stateTitle = isCloudflare
          ? 'Cloudflare WAF blocked this datacenter hosting IP (Render/AWS). Keep Manga source on Auto for automatic fallback, or use the Desktop App for direct access.'
          : (h?.error ?? undefined);

        return (
          <div key={p.id} className={`source is-${state}`}>
            <span className="source-dot" aria-hidden="true" />
            <span className="source-name">{p.name}</span>
            <span className="source-note">{p.note}</span>
            <span className="source-state num" title={stateTitle}>
              {stateLabel}
            </span>
          </div>
        );
      })}
      <div className="sources-cloud-notice">
        <span className="sources-cloud-notice-title">Web Hosting & Source Availability:</span>
        Cloudflare blocks datacenter hosting IPs (e.g. Render, AWS) for certain sources (WeebCentral, Flame) with HTTP 403.
        In <strong>Auto</strong> mode, PlayzAnime automatically skips blocked sources and serves all manhwa and manga through healthy providers (Asura Scans, MangaDex, MangaPill). For 100% direct access to all 5 sources without cloud blocks, use the <strong>PlayzAnime Desktop App</strong>.
      </div>
      <button type="button" className="sources-recheck" onClick={() => setForce((n) => n + 1)}>
        <Icon name="refresh" size={14} /> Check again
      </button>
    </div>
  );
}

/** Mihon / Tachiyomi style Extensions Manager for 55+ manga and manhwa sources. */
function ExtensionsManager() {
  const [filter, setFilter] = useState<'all' | 'manhwa' | 'manga' | 'manhua' | 'webtoon'>('all');
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0);
  const extensionsLoader = useLoader(`manga-extensions:${tick}`, () => api().manga.extensions?.() ?? Promise.resolve([]), 5 * 60_000);
  const items = extensionsLoader.data ?? [];

  const filtered = items.filter((ext) => {
    if (filter !== 'all' && ext.category !== filter) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return ext.name.toLowerCase().includes(q) || ext.note.toLowerCase().includes(q) || ext.engine.toLowerCase().includes(q);
    }
    return true;
  });

  const toggle = async (id: string, currentState: boolean) => {
    await api().manga.toggleExtension?.(id, !currentState);
    setTick((t) => t + 1);
  };

  return (
    <div className="extensions-manager">
      <div className="extensions-hero-banner">
        <div className="extensions-hero-header">
          <div className="extensions-hero-title">
            <span className="extensions-pulse-dot" />
            <h4>Multi-Source Engine (Tachiyomi / Mihon Core)</h4>
          </div>
          <span className="extensions-hero-count">
            {items.filter((x) => x.enabled).length} of {items.length} Active
          </span>
        </div>
        <p className="extensions-hero-desc">
          Extensions automatically scrape and serve chapters from scanlation groups and aggregator sources. Toggle any provider below to control what is active.
        </p>
        <div className="extensions-steps">
          <div className="extensions-step-card">
            <div className="step-num">01</div>
            <div className="step-content">
              <strong>Enable Sources</strong>
              <span>Toggle providers below. Active extensions are instantly queried.</span>
            </div>
          </div>
          <div className="extensions-step-card">
            <div className="step-num">02</div>
            <div className="step-content">
              <strong>Smart Auto-Pick</strong>
              <span>Automatically picks the source with the highest chapter count.</span>
            </div>
          </div>
          <div className="extensions-step-card">
            <div className="step-num">03</div>
            <div className="step-content">
              <strong>Switch On The Fly</strong>
              <span>On any manga or manhwa page, click <em>Source</em> to switch scanlators.</span>
            </div>
          </div>
        </div>
      </div>

      <div className="extensions-toolbar">
        <input
          type="search"
          className="extensions-search"
          placeholder="Filter 55 sources (e.g. Asura, Reaper, Bato, Toonily)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="extensions-tabs">
          {(['all', 'manhwa', 'manga', 'manhua', 'webtoon'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`extensions-tab ${filter === tab ? 'is-active' : ''}`}
              onClick={() => setFilter(tab)}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="extensions-grid">
        {filtered.map((ext) => (
          <div key={ext.id} className={`extension-card ${ext.enabled ? 'is-enabled' : 'is-disabled'}`}>
            <div className="extension-card-header">
              <span className="extension-card-name">{ext.name}</span>
              <span className={`extension-badge engine-${ext.engine}`}>{ext.engine}</span>
            </div>
            <p className="extension-card-note">{ext.note}</p>
            <div className="extension-card-footer">
              <span className="extension-badge category">{ext.category}</span>
              <button
                type="button"
                className={`extension-toggle-btn ${ext.enabled ? 'is-on' : 'is-off'}`}
                onClick={() => void toggle(ext.id, ext.enabled)}
              >
                {ext.enabled ? 'Active' : 'Disabled'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h2 className="settings-group-title">{title}</h2>
      <div className="settings-rows">{children}</div>
    </section>
  );
}

function Row({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-title">{title}</span>
        {note && <span className="settings-row-note">{note}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}
