# Haystack

Living artwork for a macOS wallpaper and Raspberry Pi TV kiosk. The local Node engine generates images using time and weather; a React Lab communicates through Express.

```bash
npm install
npm run build
npm run test:run
npm run lab
```

Copy `.env.example` to `.env.local` and configure at least one image-provider key. Keep credentials server-side. See [AGENTS.md](AGENTS.md) for architecture, kiosk and launchd operations.

[Daily artwork stories](docs/daily-stories.md) adds an opt-in local Codex writer, scheduled original-plus-previous continuity and a Spanish trailer export. Live activation and Carson's 08:00 greeting integration are separate steps.
