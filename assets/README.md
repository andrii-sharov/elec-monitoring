# Brand assets

Mark: an amber bolt cutting a pulse line, with a green "online" dot. Colours come
from the Underwater Dream theme (`docs/theme.md`); the tile gradient `#1D78A8 → #0F4664`
is derived from `--primary`. Wordmark font is Unbounded 600, converted to paths, so
no font loading is needed.

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
| `source/`        | Generators: `python3 gen.py && python3 anim.py` (needs fontTools, brotli, fontsource fonts) |
|                  | `python3 extras.py` (no fonts) writes the Telegram, illustration and portal-mark SVGs to    |
|                  | `out/`; `./png.sh <svg> <png> <w> <h>` rasterises them (and `logo-mark.svg` → email logo)   |

All animations are pure CSS inside the SVG and stop under `prefers-reduced-motion`
(the hero then shows its final frame: power on, both notifications).

## Use in `client/`

Copy `favicon/*` into `client/public/`, then in `client/index.html` `<head>`:

```html
<link rel="icon" href="/favicon.ico" sizes="48x48" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<meta name="theme-color" content="#166088" />
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
theme toggle, and falls back to the same colours from `docs/theme.md` with a
`prefers-color-scheme` switch when used as an `<img>`. The bolt and bubble keep
the fixed brand colours, like the logo. Classes are scoped under `.em-ill` so
an inlined copy doesn't leak styles. No animation inside: wrap them with
`data-motion="enter"` like other content.

## Device setup page

`portal.css` is a drop-in for `kStyle` in `firmware/src/portal.cpp`: same
selectors, theme colours, light and dark; about 1.3 KB once joined onto one line. It also
styles an optional `<header>` holding `portal-mark.svg` and the `<h1>`, and puts
the form on a card.
