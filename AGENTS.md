# Repository Guidelines

## Project Structure & Module Organization

sareoffice is Saredigital’s private fork of cubefarm: a React 19 / React Three Fiber office backed by Node.js, Express and WebSockets.
- `client/src/world/`: 3D scenes, canvas signs and interactions.
- `client/src/ui/`, `pocket/`, `photo/`: panels, mobile office and camera tools.
- `server/`: orchestration, agent runtimes, GitHub integration and demo backend.
- `server/company/`, `company-security/`, `mail/`, `company-social/`: private workflows; see `docs/security-company.md`. Real integrations require the isolated broker; legacy CLI permissions never authorize broker access.
- `shared/`: REST/WebSocket types and shared rules.
- `client/public/`: static assets; `docs/`: feature documentation.
- `scripts/` and `bin/sareoffice.js`: development, builds and launcher.

Read `CLAUDE.md` and `CONTRIBUTING.md` for detailed architecture and operating rules.

## Build, Test, and Development Commands

Use Node.js 22+ and npm (CI uses Node 24).
- `npm install`: install dependencies.
- `npm run typecheck`: check strict TypeScript.
- `npm test`: run Vitest once; `npm run test:watch`: watch changes.
- `npm run build`: typecheck and build `dist/` plus `dist-server/`.
- `npm run test:e2e`: optional Playwright browser checks when requested.

For local verification, build, set an isolated `SWARM_HOME` and a free `SWARM_PORT`, then run `node --import tsx server/index.ts --demo`. Never use live state at `~/.sareoffice` or ports 4317/5317. The `dev`, `demo` and `start` scripts run a launcher that can update its checkout; use them only in a disposable clone with isolated ports/state.

## Coding Style & Naming Conventions

Use strict TypeScript ESM, two-space indentation, single quotes and semicolons. Components use PascalCase; helpers use camelCase. Server imports include `.ts`; client imports omit extensions. No dedicated formatter or lint script is configured.

Write user-facing text and agent prompts in Spanish from Spain; keep identifiers, comments, commands and parsed literals such as `Closes #N`, `Depends on #N` and `swarm:skip` unchanged. Preserve demo parity and Windows-compatible paths/process handling.

## Testing Guidelines

Place Vitest `*.test.ts`/`*.test.tsx` beside implementations. Prefer pure logic tests; mock external services and avoid live GitHub, agents or state. No coverage threshold is configured. Browser specs belong in `e2e/<feature>.spec.ts`, using `e2e/helpers.ts`.

## Commit & Pull Request Guidelines

History uses short descriptive subjects, often followed by `(#123)`, without a mandatory Conventional Commits prefix. Write new commits and PRs in Spanish. Keep one issue per PR, include `Closes #N`, verification and assumptions, and attach demo screenshots for visual changes. Run typecheck, tests and build before submitting. Never push directly to `main`, force-push or merge your own PR.
