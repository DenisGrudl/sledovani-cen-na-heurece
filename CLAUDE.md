# CLAUDE.md

Guidance for AI assistants (Claude Code and others) working in this repository.

## Overview

This repository contains **standalone, single-file HTML applications**. There is no
build system, no package manager, no framework, and no backend. Each `.html` file is a
complete, self-contained app: markup, CSS (in a `<style>` block), and logic (in a
`<script>` block) all live in the one file and run entirely in the browser.

There are currently two unrelated apps:

| File           | Purpose                                                                 | UI language        |
| -------------- | ----------------------------------------------------------------------- | ------------------ |
| `heureka.html` | The repo's namesake: a Heureka.cz price-monitoring tool (see below).    | Czech + English    |
| `tetris.html`  | A fully playable Tetris game (keyboard + mobile controls).              | Czech              |

> Note: `tetris.html` is unrelated to price tracking — it was added as a separate
> mini-app in the same repo. Keep the two files independent; they share no code.

## How to run / test

There is nothing to install or build. To run either app:

- **Open the file directly in a browser** — double-click it, or `file://` open it, or
  run a static server from the repo root, e.g. `python3 -m http.server` and browse to
  `http://localhost:8000/heureka.html`.
- To "test", exercise the app manually in the browser. There is **no automated test
  suite, linter, or CI** configured. Do not invent build/test commands — none exist.
- A pre-installed Chromium + Playwright is available in this environment if you need to
  drive the page programmatically to verify a change (e.g. take a screenshot). Do **not**
  run `playwright install`.

## `heureka.html` — the price tracker

A client-side tool that reads an **XML export** (a Heureka product feed) chosen via a
file input, groups products by manufacturer, and displays price / popularity data. No
data leaves the browser.

Data flow:

1. User selects an `.xml` file via `#fileInput`.
2. `FileReader` reads it as text; `DOMParser` parses it as `application/xml`
   (parse errors are surfaced via `alert`).
3. Each `<PRODUCT>` element is read for these child tags:
   `manufacturer`, `product`, `itemId`, `myPrice`, `minPrice1`..`minPrice10`,
   `url`, `heurekaUrl`, `popularity`, `position`.
4. Products missing any of `manufacturer`, `product`, `itemId`, `url`, or `heurekaUrl`
   are skipped. Products are grouped into a `manufacturers` map, and per manufacturer a
   `lowestPriceCount` counts items where `myPrice === minPrice1`.
5. Manufacturers populate a `<select>` (sorted case-insensitively). Selecting one calls
   `displayManufacturerProducts`, which sorts that manufacturer's products by
   `popularity` (desc) and renders them.

**Important, environment-specific detail:** the rendered "Edit in Admin" link is
hardcoded to `https://admin.vitalita.cz/products/variant/edit/{itemId}`. This ties the
tool to a specific store's admin. If you change the admin base URL, update it in
`displayManufacturerProducts`.

Expected XML shape (per product):

```xml
<PRODUCT>
  <manufacturer>...</manufacturer>
  <product>...</product>
  <itemId>...</itemId>
  <myPrice>123.0</myPrice>
  <minPrice1>120.0</minPrice1>
  <!-- optional minPrice2 .. minPrice10 -->
  <url>...</url>
  <heurekaUrl>...</heurekaUrl>
  <popularity>0</popularity>
  <position>0</position>
</PRODUCT>
```

## `tetris.html` — the game

A canvas-based Tetris. Key facts for anyone modifying it:

- Grid: `COLS = 10`, `ROWS = 20`, `BLOCK = 30` px. Main canvas is 300×600; a small
  "next piece" preview canvas is 100×100.
- Seven tetromino shapes live in `SHAPES` (1-indexed; index 0 is a placeholder) with a
  parallel `COLORS` array. Rotation is a matrix transform (`rotate`) with simple wall
  kicks (try in place, then shift left, then right).
- Game state is a set of module-level `let` variables (`board`, `piece`, `nextPiece`,
  `score`, `level`, `lines`, etc.); the loop is driven by `requestAnimationFrame`
  (`gameLoop`) with a `dropInterval` that shortens as `level` rises.
- Controls: keyboard (arrows, space = hard drop, `P` = pause) plus on-screen mobile
  buttons and canvas swipe gestures, wired up near the bottom of the `<script>`.
- Scoring: line-clear points `[0,100,300,500,800] * level`; soft/hard drop add small
  per-cell bonuses.

## Conventions & guidance for edits

- **Keep each app single-file and dependency-free.** No CDN links, no npm packages, no
  external CSS/JS. Everything inline. This is deliberate — the files are meant to be
  opened straight from disk.
- **Match the existing style** of the file you're editing: `heureka.html` uses plain
  functions and light styling; `tetris.html` uses `const`/`let`, small helper functions,
  and a dark theme with accent color `#e94560`.
- **UI text is Czech** (with some English labels in `heureka.html`). Preserve the existing
  language of user-facing strings when editing a file, and prefer Czech for new
  user-facing text unless the surrounding file is English.
- Preserve `<meta charset="UTF-8">` — the Czech text relies on UTF-8.
- Don't introduce a build step, framework, or bundler unless the user explicitly asks for
  one; it would break the "just open the HTML" workflow.

## Git & workflow

- Default branch: `main`. Commit messages in history are in Czech and describe the change
  plainly (e.g. "Přidat funkční hru Tetris v HTML") — matching that style is welcome but
  English is fine too.
- Do not create pull requests unless explicitly asked.
- When asked to develop on a specific feature branch, create/use that branch and push
  there — never push directly to `main` without explicit permission.
