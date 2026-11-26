# Brand assets

Mark: an amber bolt cutting a pulse line, with a green "online" dot. Colours come
from the Underwater Dream theme (`docs/theme.md`); the tile gradient `#1D78A8 → #0F4664`
is derived from `--primary`. Wordmark font is Unbounded 600, converted to paths, so
no font loading is needed.

| Folder     | What                                                                                   |
| ---------- | -------------------------------------------------------------------------------------- |
| `logo/`    | `logo-mark.svg` (app tile), `logo-mark-mono.svg` (`currentColor`), `logo-animated.svg`  |
|            | `logo-{en,uk,ru}.svg` follow `prefers-color-scheme`; `-light` / `-dark` are fixed       |
| `favicon/` | `favicon.svg` (thicker lines for 16 px), `favicon.ico` (16/32/48), PNG icons, manifest |
| `social/`  | `og-image-{en,uk,ru}.png` 1200×630 (+ SVG sources)                                     |
| `hero/`    | `hero-{en,uk,ru}.svg` 12 s looping promo, plus MP4 (1920×1080) and WebP poster          |
| `source/`  | Generators: `python3 gen.py && python3 anim.py` (needs fontTools, brotli, fontsource fonts) |

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
