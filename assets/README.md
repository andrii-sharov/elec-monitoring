# Brand assets

Style: **Neon Grid**. Full brief for designers (colours, type, shapes, motion,
components): [`BRAND.md`](BRAND.md).

Mark: a lime square wave stepping between OFF and ON on a dark `#151E27` tile,
ending in a cyan "live" dot. The mark keeps these fixed colours on light and dark
backgrounds. Wordmark: JetBrains Mono 700 with an underscore cursor, converted to
paths, so no font loading is needed.

| Folder           | What                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `logo/`          | `logo-mark.svg` (app tile), `logo-mark-mono.svg` (`currentColor`), `logo-animated.svg`      |
|                  | `logo-{en,uk,ru}.svg` follow `prefers-color-scheme`; `-light` / `-dark` are fixed           |
| `favicon/`       | `favicon.svg` (thicker lines for 16 px), `favicon.ico` (16/32/48), PNG icons, manifest      |
| `social/`        | `og-image-{en,uk,ru}.png` 1200×630 (+ SVG sources)                                          |
| `hero/`          | `hero-{en,uk,ru}.svg` 12 s looping promo, plus MP4 (1920×1080) and WebP poster              |
| `email/`         | `layout.html` (branded email reference), `email-logo.png` 96×96 (shown at 40 px)            |
| `telegram/`      | `bot-avatar.png` 640×640, `bot-description.png` 640×360 (+ SVG sources)                     |
| `illustrations/` | `not-found.svg`, `history-empty.svg`, `channels-empty.svg`, 240×160, theme-aware            |
| `portal/`        | `portal-mark.svg` (< 1 KB) and `portal.css` for the device setup page                       |
| `source/`        | Generators, run from `source/`: `python3 gen.py && python3 anim.py && python3 extras.py`   |
|                  | write every SVG to `out/`. `brand.py` holds the palette and mark geometry                  |
|                  | `./png.sh <svg> <png> <w> <h>` rasterises; `snap.mjs` / `video.mjs` render hero frames      |

All animations are pure CSS inside the SVG and stop under `prefers-reduced-motion`
(the hero then shows its final frame: power on, both notifications).

## Use in `client/`

Copy `favicon/*` into `client/public/`, then in `client/index.html` `<head>`:

```html
<link rel="icon" href="/favicon.ico" sizes="48x48" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<meta name="theme-color" content="#0B1015" />
<meta property="og:image" content="/og-image-uk.png" />
```

Hero in the middle of the landing page. Use `<img>`; the CSS animation runs there and
the SVG is about 100 KB:

```html
<img src="/hero-uk.svg" width="1000" height="560" alt="…" style="max-width:100%;height:auto" />
```

Header logo that takes the app's text colour: inline `logo-mark-mono.svg`, or use
`logo-uk.svg` (switches with the system theme). The app's manual theme toggle
sets `.dark` on `<html>`, which an `<img>` can't see, so if you need it to follow
the toggle, render `logo-uk-light.svg` / `logo-uk-dark.svg` based on that class.

## Emails

Mail clients drop SVG and Gmail blocks `data:` images, so emails load
`email-logo.png` from the client's public URL (copy it to `client/public/`).
`layout.html` is table-based with inline styles; the `{{…}}` placeholders map to
what `server/src/email/templates.ts` already renders (intro, action, link,
notes, footer) plus `appName`, `preheader`, `linkHint` and `logoUrl`. Colours are
the light theme tokens, with a `prefers-color-scheme: dark` block for clients
that support it (Apple Mail, iOS); Gmail keeps the light version.

## Telegram

Upload in BotFather: `/setuserpic` → `bot-avatar.png` (Telegram crops it to a
circle; the artwork stays inside it), `/setdescription` picture →
`bot-description.png`.

## Illustrations

For empty and error states in `client/`. Each SVG paints with the app's theme
tokens (`--primary`, `--status-online`, …) when inlined, so it follows the
theme toggle, and falls back to the Neon Grid colours from `BRAND.md` with a
`prefers-color-scheme` switch when used as an `<img>`. Until the app's own tokens
move to Neon Grid, an inlined copy takes the app's current colours. The chat
bubble's wave keeps the fixed brand colours, like the logo. Classes are scoped under `.em-ill` so
an inlined copy doesn't leak styles. No animation inside: wrap them with
`data-motion="enter"` like other content.

## Device setup page

`portal.css` is a drop-in for `kStyle` in `firmware/src/portal.cpp`: same
selectors, theme colours, light and dark; about 1.3 KB once joined onto one line. It also
styles an optional `<header>` holding `portal-mark.svg` and the `<h1>`, and puts
the form on a card.

## Rebuilding

Needs Python with `fonttools` and `brotli`, Node with `playwright`, Chrome, ImageMagick
and ffmpeg. Fonts come from npm into `source/fonts/` (not committed):

```sh
cd source/fonts
npm pack @fontsource/jetbrains-mono @fontsource/inter
mkdir fontsource-jetbrains-mono-5.3.0 fontsource-inter-5.3.0
tar xzf fontsource-jetbrains-mono-*.tgz -C fontsource-jetbrains-mono-5.3.0
tar xzf fontsource-inter-*.tgz -C fontsource-inter-5.3.0
```

`png.sh` uses macOS Chrome by default; on Linux run it with
`CHROME=/usr/bin/google-chrome` (as root also `CHROME_FLAGS=--no-sandbox`).
`favicon.ico` = `favicon.svg` at 16/32/48 joined with `convert`. Hero MP4 = 360
frames from `video.mjs` → `ffmpeg -c:v libx264 -crf 24 -pix_fmt yuv420p`; the WebP
poster is frame 300 (10 s).
