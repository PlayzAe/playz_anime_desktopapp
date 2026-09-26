# Brief

Your requests, tightened into one prompt you can reuse. Update it whenever the goal changes.

## Improved prompt

> Turn my PlayzAe.Tv web app (`C:\Users\Moses\Desktop\tes`: Vite + TypeScript frontend, Python + Selenium backend) into a Windows desktop app called **PlayzAnime**, built with Electron in `C:\Users\Moses\Desktop\Dev Code\Electron Conversion`.
>
> **Scope.** Anime: browse, search, watch, and download episodes. Manga: browse, search, read, and download chapters.
>
> **Reference.** Download github.com/5rahim/seanime into the project as a UX reference only. Take heavy inspiration from its structure (side rail, spotlight hero, library by status, airing schedule, download queue). Don't copy its look or its code.
>
> **Brand and design.** One standalone "P" logo. A custom icon set that doesn't look like a stock library or AI output. A distinctive, premium dark UI with no generic AI patterns. The user experience comes first: fast, keyboard-friendly, clear empty and error states.
>
> **Downloads.** Separate anime and manga folders that users can pick and change at any time.
>
> **Deliverables.**
> 1. `start.bat` for local testing.
> 2. A portable, fully bundled `PlayzAnime.exe` that needs no install.
> 3. A Discord/Spotify-style installer: choose a folder, Start menu and desktop shortcuts, uninstaller.
>
> **Constraints.** Keep the build as light as the stack allows. I work on a metered hotspot, so keep live testing to about 5 seconds of playback or 1–2 manga pages, and don't download large files as tests.
>
> **Done when.** All three builds launch. An anime episode plays and downloads. A manga chapter reads and downloads. Every screen follows the same design.

## Decisions taken along the way

- **Manga.** The first message said anime only. A later one said to add manga with its own download folder. Manga is in.
- **Name.** PlayzAe became PlayzAnime everywhere: exe, installer, window title, app id, data folder.
- **ffmpeg.** It comes out of the installer (80 MB). The app fetches it once, on the first episode download.
- **Sources.** Manga uses MangaDex (exact AniList id match) plus MangaPill (covers licensed titles MangaDex lacks). The app picks whichever has more chapters, and you can switch per title.
- **Data saver.** Added because of the hotspot, and it's useful for anyone on a capped plan.
