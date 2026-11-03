# @remode/web

ReMode's browser workbench (M2a): React 19 + Vite 8 + Tailwind 4, built as a static site in
`dist/`. Every step runs locally through `@remode/core`, which Vite compiles from its
TypeScript sources via the `@remode/source` export condition. There is no network I/O at
runtime.

| Path | What |
|---|---|
| `src/state/project.ts` | Reducer: parsed input, the deep-frozen original, settings and the generated variant are kept in separate slots. Pure; `createdAt` comes in the action. |
| `src/lib/` | Loading files and text (`loadInput`), limits, mode pickers, Chinese labels for core codes, export and download, theme preference. |
| `src/components/` | Import, track list, validation and repair, source mode, target, change inspector, analysis and PCD chart. |
| `public/_headers` | Response headers (CSP) for Workers static assets. `vite preview` sends them too. |
| `test/` | Vitest + Testing Library (jsdom): reducer, components, AA contrast of the colour tokens. |
| `e2e/` | Playwright against `vite build && vite preview`: workflow, uploads, errors, theme, keyboard, phone layout, plus a no-network/no-CSP-violation guard on every test. |

Commands and deployment settings are in the root [README](../../README.md#web-workbench).
