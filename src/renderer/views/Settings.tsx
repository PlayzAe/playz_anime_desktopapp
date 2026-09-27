import { useEffect, useState, type ReactNode } from 'react';
import { MANGA_PROVIDERS, type AccentKey, type MangaExtensionInfo, type ProviderHealth, type Settings as SettingsT } from '../../shared/types';
import { Button, Segmented, Select, Switch } from '../components/Controls';
import { Icon, type IconName } from '../components/Icon';
import { Logo } from '../components/Logo';
import { Modal } from '../components/Modal';
import { useLoader } from '../lib/data';
import { CHANGELOG_URL, DOCS_URL, GITHUB_URL, POLICIES_URL, RELEASES_URL } from '../lib/links';
import { useApp } from '../lib/store';
import './settings.css';

const api = () => window.playzanime;
const open = (url: string) => void api().app.openExternal(url);

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

const SECTIONS: { id: string; title: string }[] = [
  { id: 'look', title: 'Look' },
  { id: 'watching', title: 'Watching' },
  { id: 'reading', title: 'Reading' },
  { id: 'sources', title: 'Sources' },
  { id: 'downloads', title: 'Downloads' },
  { id: 'privacy', title: 'Network & privacy' },
  { id: 'data', title: 'Your data' },
  { id: 'keyboard', title: 'Keyboard' },
  { id: 'help', title: 'Help' },
  { id: 'about', title: 'About' },
];

export function Settings() {
  const { settings, updateSettings, toast, clearAllHistory } = useApp();
  const info = useLoader('appinfo', () => api().app.info(), Infinity);
  const [confirm, setConfirm] = useState(false);
  const set = <K extends keyof SettingsT>(key: K, value: SettingsT[K]) => void updateSettings({ [key]: value } as Partial<SettingsT>);
  // Until app info arrives, desktop-only rows wait rather than flash in and out on the web.
  const web = info.data ? info.data.platform === 'web' : null;
  const desktop = web === false;

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

      <div className="settings-layout">
        <SectionIndex />

        <div className="settings-body">
          <Group id="look" title="Look">
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

          <Group id="watching" title="Watching">
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

          <Group id="reading" title="Reading">
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
          </Group>

          <Group id="sources" title="Sources" note="Where chapters come from. Titles and artwork always come from AniList.">
            <Row title="Manga source" note="Auto checks every source for each title and reads from the one that’s furthest along, skipping any that are down.">
              <Select
                label="Manga source"
                value={settings.mangaProvider}
                onChange={(v) => set('mangaProvider', v)}
                width={180}
                options={[{ value: 'auto', label: 'Auto (recommended)' }, ...MANGA_PROVIDERS.map((p) => ({ value: p.id, label: p.name }))]}
              />
            </Row>
            <SourceHealth web={web === true} />
            <ExtensionsManager web={web === true} />
          </Group>

          <Group id="downloads" title="Downloads">
            {web && (
              <Row title="Downloads are in the Windows app" note="Saving episodes (MP4) and chapters (CBZ) for offline needs a real disk. Here in the browser you stream and read.">
                <Button variant="primary" size="sm" icon="downloads" onClick={() => open(RELEASES_URL)}>
                  Get the Windows app
                </Button>
              </Row>
            )}
            {desktop && (
              <>
                <Row title="Anime folder" note={<span className="settings-path">{settings.animeDir}</span>}>
                  <div className="row-buttons">
                    <Button variant="quiet" size="sm" icon="folder" onClick={() => void api().app.openDir('anime')}>
                      Open
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void chooseDir('anime')}>
                      Change
                    </Button>
                  </div>
                </Row>
                <Row title="Manga folder" note={<span className="settings-path">{settings.mangaDir}</span>}>
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
              </>
            )}
          </Group>

          <Group id="privacy" title="Network & privacy">
            <Row title="Data saver" note="For hotspots and capped plans: smaller video buffers, 720p at most, no pre-loading of the next episode, and compressed manga pages where the source offers them.">
              <Switch checked={settings.dataSaver} onChange={(v) => set('dataSaver', v)} label="Data saver" />
            </Row>
            {desktop && (
              <Row title="Block ads and pop-ups" note="Filters ad and tracker requests inside embedded players. Pop-up windows are always blocked.">
                <Switch checked={settings.adblock} onChange={(v) => set('adblock', v)} label="Block ads" />
              </Row>
            )}
            <Row title="Hide adult titles" note="Leaves 18+ entries out of every list and search.">
              <Switch checked={settings.hideAdult} onChange={(v) => set('hideAdult', v)} label="Hide adult titles" />
            </Row>
          </Group>

          <Group id="data" title="Your data" note={web ? 'Everything is kept in this browser. Nothing is sent to an account.' : 'Everything is kept on this PC. There are no accounts.'}>
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
              <Button variant="ghost" size="sm" icon="trash" onClick={() => setConfirm(true)}>
                Clear history
              </Button>
            </Row>
          </Group>

          <Group id="keyboard" title="Keyboard">
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

          <Group id="help" title="Help">
            <div className="link-list">
              <LinkRow icon="info" title="Guides and FAQ" note="How watching, reading, sources and downloads work." url={DOCS_URL} />
              <LinkRow icon="bolt" title="What’s new" note="Release notes for every version." url={CHANGELOG_URL} />
              {web && <LinkRow icon="downloads" title="PlayzAnime for Windows" note="Downloads, offline mode and every source, free." url={RELEASES_URL} />}
              <LinkRow icon="shield" title="Terms, privacy and copyright" note="What PlayzAnime is, what it keeps, and how to send a DMCA notice." url={POLICIES_URL} />
              <LinkRow icon="layers" title="Source code" note="The Windows app, the web app and the website, on GitHub." url={GITHUB_URL} />
            </div>
          </Group>

          <Group id="about" title="About">
            <div className="about">
              <Logo size={56} />
              <div className="about-text">
                <p className="about-name">PlayzAnime {web ? 'on the web' : info.data?.version}</p>
                {desktop && info.data && (
                  <p className="faint num">
                    Electron {info.data.electron} · Chromium {info.data.chrome.split('.')[0]}
                  </p>
                )}
                <p className="about-credits">
                  Titles, artwork and schedules come from AniList. Chapters come from MangaDex, Asura Scans, WeebCentral, Flame Comics, MangaPill and community sources, and episodes
                  from third-party hosts. PlayzAnime doesn’t host, upload or store any video or pages
                  {web ? '; its server only forwards requests as they happen' : ''}. It isn’t affiliated with any source, studio, publisher or streaming service.
                </p>
                <p className="about-credits">
                  By using PlayzAnime you agree to its{' '}
                  <a
                    href={POLICIES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault();
                      open(POLICIES_URL);
                    }}
                  >
                    terms, copyright policy and privacy policy
                  </a>
                  .
                </p>
                {desktop && info.data?.userData && (
                  <p className="faint about-data" title={info.data.userData}>
                    Settings and history live in <span className="settings-path">{info.data.userData}</span>
                  </p>
                )}
                <div className="about-support">
                  <p>Free, with no ads, and it stays that way. If it earns a place on your {web ? 'bookmarks bar' : 'desktop'}, a star on GitHub keeps it going.</p>
                  <Button variant="ghost" size="sm" icon="heart" onClick={() => open(GITHUB_URL)}>
                    Star on GitHub
                  </Button>
                </div>
              </div>
            </div>
          </Group>
        </div>
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

/** The list of sections down the side; the one being read is highlighted. */
function SectionIndex() {
  const [active, setActive] = useState(SECTIONS[0].id);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);
  return (
    <nav className="settings-index" aria-label="Settings sections">
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className={s.id === active ? 'is-active' : undefined}
          aria-current={s.id === active ? 'true' : undefined}
          onClick={(e) => {
            e.preventDefault();
            setActive(s.id);
            document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          {s.title}
        </a>
      ))}
    </nav>
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

/** Which built-in chapter sources answer right now, and how quickly. */
function SourceHealth({ web }: { web: boolean }) {
  const [force, setForce] = useState(0);
  const health = useLoader(`manga-health:${force}`, () => api().manga.health(force > 0), 60_000);
  const byId = new Map<string, ProviderHealth>((health.data ?? []).map((h) => [h.provider, h]));
  const blocked = MANGA_PROVIDERS.filter((p) => byId.get(p.id)?.error?.includes('403'));

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">
          <strong>Built-in sources</strong>
          <span>Checked every few minutes. Auto skips any that are down.</span>
        </div>
        <Button variant="quiet" size="sm" icon="refresh" onClick={() => setForce((n) => n + 1)} disabled={health.loading}>
          Check again
        </Button>
      </div>
      <ul className="sources">
        {MANGA_PROVIDERS.map((p) => {
          const h = byId.get(p.id);
          const state = !h ? 'checking' : h.ok ? (h.ms > 4000 ? 'slow' : 'up') : h.error?.includes('403') ? 'blocked' : 'down';
          const label = { checking: 'Checking…', up: `${((h?.ms ?? 0) / 1000).toFixed(1)} s`, slow: `Slow · ${((h?.ms ?? 0) / 1000).toFixed(1)} s`, blocked: 'Blocked here', down: 'Down' }[state];
          return (
            <li key={p.id} className={`source is-${state}`}>
              <span className="source-dot" aria-hidden="true" />
              <span className="source-text">
                <span className="source-name">{p.name}</span>
                <span className="source-note">{p.note}</span>
              </span>
              <span className="source-state num" title={h?.error ?? undefined}>
                {label}
              </span>
            </li>
          );
        })}
      </ul>
      {blocked.length > 0 && (
        <div className="callout" role="note">
          <Icon name="alert" size={17} />
          <div>
            <p>
              <strong>{blocked.map((b) => b.name).join(' and ')}</strong> {blocked.length > 1 ? 'turn' : 'turns'} away {web ? 'cloud servers like the one this site runs on' : 'this connection'}.{' '}
              {web
                ? 'Auto reads from the other sources instead. The Windows app connects from your own PC, so it reaches every source.'
                : 'Auto reads from the other sources instead. A VPN or another network usually gets through.'}
            </p>
            {web && (
              <Button variant="ghost" size="sm" icon="downloads" onClick={() => open(RELEASES_URL)}>
                Get the Windows app
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const CATEGORIES = ['all', 'manhwa', 'manga', 'manhua', 'webtoon'] as const;
const PREVIEW = 12;

/** The community sources (Mihon / Tachiyomi style), each one on or off. */
function ExtensionsManager({ web }: { web: boolean }) {
  const [filter, setFilter] = useState<(typeof CATEGORIES)[number]>('all');
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const [tick, setTick] = useState(0);
  const loader = useLoader(`manga-extensions:${tick}`, () => api().manga.extensions?.() ?? Promise.resolve([] as MangaExtensionInfo[]), 5 * 60_000);
  const items = loader.data ?? [];
  if (!items.length) return null;

  const q = query.trim().toLowerCase();
  const matches = items.filter(
    (ext) => (filter === 'all' || ext.category === filter) && (!q || `${ext.name} ${ext.note} ${ext.engine}`.toLowerCase().includes(q)),
  );
  const shown = all || q || filter !== 'all' ? matches : matches.slice(0, PREVIEW);
  const on = items.filter((x) => x.enabled).length;

  const toggle = async (ext: MangaExtensionInfo) => {
    await api().manga.toggleExtension?.(ext.id, !ext.enabled);
    setTick((t) => t + 1);
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">
          <strong>Community sources</strong>
          <span>
            Scanlation groups and aggregators, asked alongside the built-in ones. Turn off any you don’t want. On a series page, <em>Source</em> switches between them.
          </span>
        </div>
        <span className="panel-count num">
          {on} of {items.length} on
        </span>
      </div>

      <div className="ext-toolbar">
        <label className="ext-search">
          <Icon name="search" size={15} />
          <input type="search" placeholder={`Filter ${items.length} sources`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter sources" />
        </label>
        <Segmented
          size="sm"
          label="Kind"
          value={filter}
          onChange={setFilter}
          options={CATEGORIES.map((c) => ({ value: c, label: c === 'all' ? 'All' : c[0].toUpperCase() + c.slice(1) }))}
        />
      </div>

      {shown.length === 0 ? (
        <p className="ext-empty">No source matches “{query}”.</p>
      ) : (
        <ul className="ext-list">
          {shown.map((ext) => {
            const unavailable = web && ext.desktopOnly;
            return (
              <li key={ext.id} className={`ext ${ext.enabled ? '' : 'is-off'}`}>
                <span className="ext-text">
                  <span className="ext-name">
                    {ext.name}
                    <span className="ext-tag">{ext.category}</span>
                    {unavailable && <span className="ext-tag is-warn">Windows app</span>}
                  </span>
                  <span className="ext-note" title={ext.note}>
                    {ext.note}
                  </span>
                </span>
                <Switch checked={ext.enabled} onChange={() => void toggle(ext)} label={`${ext.name} source`} />
              </li>
            );
          })}
        </ul>
      )}

      {!q && filter === 'all' && matches.length > PREVIEW && (
        <button type="button" className="ext-more" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${matches.length}`}
          <Icon name="chevronDown" size={15} className={all ? 'is-flipped' : undefined} />
        </button>
      )}
    </div>
  );
}

function LinkRow({ icon, title, note, url }: { icon: IconName; title: string; note: string; url: string }) {
  return (
    <a
      className="link-row"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        open(url);
      }}
    >
      <span className="link-row-icon">
        <Icon name={icon} size={17} />
      </span>
      <span className="link-row-text">
        <span className="link-row-title">{title}</span>
        <span className="link-row-note">{note}</span>
      </span>
      <Icon name="external" size={15} className="link-row-go" />
    </a>
  );
}

function Group({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} className="settings-group" aria-labelledby={`${id}-title`}>
      <div className="settings-group-head">
        <h2 id={`${id}-title`} className="settings-group-title">
          {title}
        </h2>
        {note && <p className="settings-group-note">{note}</p>}
      </div>
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
