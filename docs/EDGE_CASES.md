# Edge cases

These are the problems people actually hit with apps like this one. They were collected from the ~500 issues on [Seanime's tracker](https://github.com/5rahim/seanime/issues) and from testing PlayzAnime on real Windows machines. Each entry says what goes wrong, how PlayzAnime handles it, and where the handling lives.

| # | What goes wrong | How PlayzAnime handles it | Where |
|---|---|---|---|
| 1 | **Video freezes while the audio keeps going**, usually after rapid seeking (seanime #889, #822, #847) | Held-down seek keys are added up and applied once. A watchdog notices when time moves but no new frame appears for 4 s, and rebuilds the decoder in place. | `player/DirectPlayer.tsx` |
| 2 | **A stream link expires mid-episode** with HTTP 403 (#808) | The first failure fetches a fresh link silently and resumes at the same second. Only a second failure is shown. | `views/Watch.tsx` |
| 3 | **Sub/dub choice isn't remembered per show** (#812) | Each show reopens in the audio you last used for it, and only then falls back to the global preference. | `views/Watch.tsx` |
| 4 | **Arabic, Hebrew or CJK subtitles render wrong or as boxes** (#684, #546) | Every cue line takes its direction from its own text, and the font stack falls back to system fonts for those scripts. | `player/player.css` |
| 5 | **Opening a chapter marks it read** (#759) | A chapter counts as read only once its last page has been on screen for a few seconds. | `views/Reader.tsx` |
| 6 | **Manhwa opens in page mode** (#418) | Korean and Chinese webtoons open as one long strip. Switching modes there only affects that series. | `views/Reader.tsx` |
| 7 | **A source goes down or loses a chapter** (#728, #369) | Sources are health-checked, and dead ones are skipped instead of waited on. "Read this chapter from another source" finds the same chapter number elsewhere. | `main/manga.ts`, `views/Reader.tsx` |
| 8 | **The default source is ignored, or the wrong one is picked** (#447, #840) | A chosen source is used when it has the title. Otherwise the app picks the source with the furthest chapter you can read in the app; links to official apps don't count. | `main/manga.ts` |
| 9 | **A title isn't found because of punctuation** ("I’m the Max-Level Newbie") | Searches use plain quotes and dashes, then fall back to distinctive keywords. Matching ignores leading articles ("A Regressor’s Tale" = "Regressor’s Tale"). | `main/sources/*.ts` |
| 10 | **Chapter downloads fail on AVIF or unusual JPEGs** (#860, #807) | Pages are stored byte for byte, never decoded or re-encoded. The file extension comes from the image's own signature. | `main/downloader.ts` |
| 11 | **Downloads vanish or break after files are moved** (#905, #641) | Missing files are detected and flagged in Downloads, with a clear message instead of a spinner. Finished downloads are never cleared by "clear list". | `main/downloader.ts`, `views/Downloads.tsx` |
| 12 | **No internet** (#592, #457, #455) | Opening offline lands on Downloads. Episodes play (with seeking and subtitles) and CBZs read inside the app, and progress still counts. | `main/offline.ts`, `views/OfflineWatch.tsx` |
| 13 | **Windows blocks saving** (Controlled folder access; the cause of stuck downloads during testing) | Detected at setup, with one-click allow-listing through Windows' own admin prompt and a Downloads-folder fallback. ffmpeg writes to temp and the app moves the file, so only PlayzAnime needs access. Error messages name the cause. | `main/windowsGuard.ts`, `tools/` |
| 14 | **Launching twice crashes or opens a second copy** (#483) | Single instance: a second launch focuses the window, and a double-clicked `.playzanime` file is handed over and imported. | `main/index.ts` |
| 15 | **No guidance on first launch** (#916) | A one-time setup walks through folders, folder protection and a profile, and never shows again. | `views/FirstRun.tsx` |

Also handled along the way:

- **The disk is full.** The download says so, keeps what it saved, and resumes later.
- **A crash on missing AniList fields** (#931). TypeScript strict null checks cover every optional field.
- **Per-user install without admin** (#943). The installer installs for the current user by default.
