<p align="center">
  <a href="https://playzae.github.io/playz_anime_landingpage/">
    <img src="https://raw.githubusercontent.com/PlayzAe/playz_anime_landingpage/main/public/icon.png" alt="PlayzAnime Logo" width="75px" />
  </a>
</p>

<h1 align="center"><b>PlayzAnime - Desktop Edition</b></h1>

<p align="center">
  <img src="https://raw.githubusercontent.com/PlayzAe/playz_anime_landingpage/main/public/og.png" alt="PlayzAnime Preview" width="100%" />
</p>

<p align="center">
  <a href="https://playzae.github.io/playz_anime_landingpage/">Website</a> |
  <a href="https://playz-anime.onrender.com">Web App</a> |
  <a href="https://github.com/PlayzAe/playz_anime_desktopapp/releases/tag/Playz_Anime">Download Release</a> |
  <a href="#features">Features</a> |
  <a href="#why-i-built-playzanime-inspiration--better-downloads">Why PlayzAnime?</a> |
  <a href="https://playzae.github.io/playz_anime_landingpage/docs/policies/dmca">Copyright</a>
</p>

<div align="center">
  <a href="https://github.com/PlayzAe/playz_anime_desktopapp/releases/tag/Playz_Anime">
    <img src="https://img.shields.io/badge/Release-Playz__Anime-crimson?style=flat-square" alt="Release" />
  </a>
  <img src="https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-f0532c?style=flat-square" alt="Windows 10 and 11" />
  <img src="https://img.shields.io/badge/Electron-30+-2b2622?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19-2b2622?style=flat-square&logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Ads-None-93c48d?style=flat-square" alt="No ads" />
  <a href="https://github.com/PlayzAe"><img src="https://img.shields.io/static/v1?label=Support&message=GitHub&style=flat-square&logo=GitHub&color=%23f0532c" alt="Support" /></a>
</div>

<br>

## About

I built **PlayzAnime Desktop** because I wanted a clean, fast, standalone Windows app for **watching and downloading anime** and **reading and downloading manga, manhwa, and manhua** without dealing with web ads, slow torrent swarms, or bloated media servers.

All metadata, trending lists, and seasonal schedules sync directly from AniList. Anime streams and manga chapters are fetched straight from resilient online sources. My app features its own native video player, a responsive manga reader, offline media library storage, and portable profiles you can easily export and share with friends as a file.

> [!IMPORTANT]
> PlayzAnime does not host, upload, or distribute any media. It parses content that third-party sites already make publicly available. Users are responsible for complying with their local copyright laws.

---

## Why I Built PlayzAnime (Inspiration & Better Downloads)

[Seanime](https://github.com/5rahim/seanime) was a huge inspiration for my UI layout, tracker integration, and overall vision. But if you have ever looked through community issue trackers, you know the biggest headaches with traditional anime media servers: **torrents dying, buffer holes, and download corruption.**

Most media servers depend heavily on BitTorrent protocols:
- If a torrent has **0 seeders**, your download is dead in the water.
- If leechers choke the swarm, your speeds drop to a crawl.
- Torrents trigger ISP copyright letters unless you pay for a VPN or a Debrid service.
- If your system crashes or restarts mid-torrent, files frequently recheck or get corrupted.

### How I do it differently:
- **Zero Seeder Dependency:** My downloads **never** rely on seeders, peers, or torrent swarms. Mine will never go down unless the provider itself goes down.
- **Unstoppable Auto-Resume:** You can pause, turn off your PC, restart your computer, or lose your internet connection completely - my downloader immediately picks up right at the exact byte it left off from. Nothing gets corrupted.
- **Smart Chunk Architecture:** How do I bypass stream throttling and pack clean MP4s with embedded subtitles automatically? That is my secret sauce - **look through the source code in this repo** if you want to see how my download engine works under the hood.
- **Self-Contained & Lightweight:** No complex local Docker daemons, external database services, or complex ports to forward. Just double-click and run.

### Issues I Specifically Solved in My App:
- **HLS Buffer Holes & Stream Stalls** (#953, #847): My HLS player uses an adaptive pre-buffering pipeline with seamless quality fallback so playback never stutters.
- **Subtitle Desync & Disappearing Tracks** (#940, #919, #881): Subtitles are extracted and rendered directly in my custom player pipeline.
- **Downloads Stuck at 0 KB/s** (#957, #912): No waiting for peers or dead torrents; chunks download at maximum CDN wire speed.
- **Manga Cache Loss After Restart** (#905, #641): All downloaded manga chapters save directly as standard `.cbz` files with `ComicInfo.xml` metadata in permanent disk folders.
- **Player Closes Between Episodes** (#902): Full autoplay progression queue - the next episode loads smoothly without closing your player window.
- **Border Scroll Bugs in Manga Reader** (#903, #918): Fully optimized smooth keyboard navigation and infinite scroll.

---

## Features

- **My Own Native Player:** Streams play directly in PlayzAnime's player with zero ads: auto skip intro/outro, next episode autoplay, subtitle rendering in any language, keyboard shortcuts, picture-in-picture, taskbar playback controls, and Windows media keys.
- **Bulletproof Downloads:** Episodes download as standard MP4 with embedded subtitles; manga chapters download as CBZ. Downloads resume automatically where they stopped, survive system restarts, and organize cleanly: `PlayzAnime\<Show>\Season 2\<Show>_E05_720p.mp4` and `PlayzManga\<Series>\<Series>_Ch012.cbz`.
- **True Offline Mode:** With zero internet connection, PlayzAnime opens straight to your local library. Watch downloaded episodes and read saved manga chapters grouped by series, season, and quality.
- **Multi-Source Manga Auto-Pick:** MangaDex, WeebCentral, Flame Comics, and MangaPill are searched in parallel. My app automatically serves chapters from whichever source is furthest along, skipping any that are unresponsive. Includes a live health check in Settings.
- **Dual-Mode Manga Reader:** Traditional manga opens right-to-left in single pages; manhwa and webtoons open in a continuous vertical scroll strip. Features fit-to-width/height, keyboard navigation, and instant source switching.
- **Portable User Profiles:** Create a custom profile with avatars and favorite lists. Export your profile as a compact `.playzanime` file to share with friends, allowing them to view your watchlist in its own isolated tab.
- **Automated First-Run Setup:** First launch sets up storage directories, verifies Windows Controlled Folder Access (with one-click allowlisting), and warms the catalog in your custom accent theme.
- **Low-Bandwidth Data Saver:** Limits video buffer consumption, caps stream resolution at 720p, and serves compressed image pages from providers.

---

## Screenshots

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/PlayzAe/playz_anime_landingpage/main/public/screenshots/home.png" alt="Home Screen" /></td>
    <td><img src="https://raw.githubusercontent.com/PlayzAe/playz_anime_landingpage/main/public/screenshots/manga.png" alt="Manga Reader" /></td>
  </tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/PlayzAe/playz_anime_landingpage/main/public/screenshots/downloads.png" alt="Downloads Manager" /></td>
    <td><img src="https://raw.githubusercontent.com/PlayzAe/playz_anime_landingpage/main/public/screenshots/profiles.png" alt="User Profiles" /></td>
  </tr>
</table>

---

## Get started

Grab the latest build from my official release:

<p align="center">
<a href="https://github.com/PlayzAe/playz_anime_desktopapp/releases/tag/Playz_Anime" style="font-size:18px;">
<b>Download PlayzAnime v0.1.0 for Windows -></b>
</a>
</p>

1. Download **`PlayzAnime-Setup-0.1.0.exe`** (Installer) or **`PlayzAnime-Portable-0.1.0.exe`** (Single Portable Binary).
2. If Windows SmartScreen displays a warning for unsigned software: click **More info** -> **Run anyway**.
3. Launch the app. First-run configuration takes under a minute.

> [!TIP]
> **Controlled Folder Access Warning:** If Windows Defender Ransomware Protection is enabled, it may block writes to Desktop/Documents. Choose **Allow PlayzAnime** during setup or in **Settings -> Downloads**, or run `resources\tools\allow-folder-access.bat` from the installation directory.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl K` or `/` | Search anime and manga |
| `Space` or `K` | Play / Pause |
| `J` / `L` | Seek backward / forward 10 seconds |
| `<-` / `->` | Seek backward / forward 5 seconds |
| `N` / `P` | Next / Previous episode |
| `S` | Skip intro / outro |
| `C` | Cycle subtitles |
| `F` / `T` | Fullscreen / Theater mode |
| `[` / `]` | Previous / Next manga chapter |
| `M` | Switch between Scroll and Page reading mode |

---

## Development & Build

### Prerequisites
- Node.js >= 20 LTS
- npm >= 9
- Windows 10 or 11 (64-bit)

### Commands
```bash
# Start development server with hot-reload
npm run dev

# Run self-tests (verifies HLS extraction, MP4 remuxing, offline storage)
npm run selftest

# Package Windows Installer and Portable executable
npm run package:win
```

The compiled binaries will be output to the `release/` directory.

---

## Tech Stack

* **Shell & Core:** [Electron](https://www.electronjs.org/)
* **Frontend:** [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vite.dev/)
* **Media Remuxing:** [ffmpeg](https://ffmpeg.org/) (downloaded on demand for episode packaging)
* **Metadata & Tracker:** [AniList GraphQL API](https://graphql.anilist.co)

---

## License & Policies

Distributed under custom fair-use terms. For DMCA notices and takedown requests, consult [Legal & DMCA Policies](https://playzae.github.io/playz_anime_landingpage/docs/policies/dmca).