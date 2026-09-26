# Next steps (handoff, 2026-09-25 ~08:20)

## Done in this round
- Downloads: Desktop\PlayzAnime / Desktop\PlayzManga, `Show\Season N\Show_E05_720p.mp4`, `Series\Series_Ch012.cbz`.
- Controlled folder access: detection plus an allow flow in setup and in Settings → Downloads, a Downloads-folder fallback, and `tools/allow-folder-access.*` (shipped in resources\tools). ffmpeg now writes to temp and the app moves the file.
- Offline mode: `pzmedia://` serves downloaded MP4s (byte ranges, subtitles) and CBZ pages. Opening the app offline lands on Downloads. Downloads are grouped series → episode → quality.
- Profiles: onboarding, badge in the rail, Profiles tab, `.playzanime` export/import by drag-drop, file picker or double-click (file association), with an import animation.
- First-run setup with a `motion` intro. Dev (`start.bat`) shows it every launch; builds show it once.
- Sources: MangaDex, WeebCentral, Flame Comics and MangaPill, with health checks and auto-pick. `npm run probe -- manga shelf` showed 23/24 of the manhwa shelf readable.
- Episode stills from Kitsu where AniList has none.
- The 15 edge cases in docs/EDGE_CASES.md. The README has screenshots (`npm run docs:shots`).
- Self-test: 25 checks pass.

## Open
1. **Barbarian's Adventure in a Fantasy World** has no source. Candidates: Asura Scans (asurascans.com answers) and MangaKakalot/NatoManga (Cloudflare gives 403 to Node fetch; it might pass through Electron `net.fetch`).
2. Live-check the Kitsu stills on Grand Blue S3 (MAL id matters) and Bleach 21+ in the running app.
3. Portable exe: CFA allow-listing uses `process.execPath`, which for the portable build is the extracted temp copy. Test whether that path stays stable between runs.
4. Test the `.playzanime` double-click from an installed build (the association is only registered by the NSIS installer).
5. Code-signing to remove the SmartScreen warning.

## Always
- Keep live tests tiny (hotspot): 5 s of playback or 1–2 manga pages. Prefer `npm run selftest` and the probes.
- After changes: `npm run typecheck`, `npm run selftest`, and launch dev mode to confirm the window responds.
