# Contributing

Danke fürs Mitmachen! / Thanks for helping out.

## Setup

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Requires Node 20+. `npm run dev` watches and rebuilds; set `OBSIDIAN_PLUGIN_DIR` to a vault plugin folder to load it live in Obsidian.

## Layout

- `src/engine/` – pure rules engine (dice, combat, effects, hit zones); no Obsidian imports, covered by unit tests.
- `src/<feature>/` – one folder per feature (`cockpit`, `probe`, `magic`, `calendar`, `regie`, `encounter`, `groupprobe`, `share`, `hero`, `bestiary`), registered from `src/main.ts`.
- `tests/` – Vitest. Tests named `*.real.test.ts` (and a few others) run against a real vault if present and are skipped otherwise, so CI stays green without private data. Point them at a vault with `DSA_VAULT=<path> npm test`.
- `scripts/gen-talents.mjs` – regenerates `src/data/talents.generated.ts` from a vault rule note (`DSA_VAULT=<path>`); the generated file is committed.

## Guidelines

- Keep rule logic in the engine with tests; keep UI code thin.
- UI strings are German.
- Never hard-code vault paths: add a setting (`src/settingsData.ts`, with a legacy value if it replaces old behaviour) and document conventions in `docs/VAULT.md`.
- Do not commit copyrighted rule text, bestiary entries or personal campaign/hero data.

## Releasing

1. `npm version <patch|minor|major>` – bumps `package.json`, `manifest.json` and `versions.json`.
2. `git push --follow-tags` – the Release workflow builds and attaches `main.js`, `manifest.json`, `styles.css`.

(Tags have no `v` prefix: the repository `.npmrc` sets `tag-version-prefix=""` so `npm version` creates `1.2.3`, which the Release workflow matches.)
