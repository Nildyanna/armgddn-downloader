# Making a theme for the ARMGDDN app

The new ARMGDDN app (the Companion's own library window) is a web page running inside the app. A theme is three things: a **palette**, an optional **CSS layer** that gives it a personality, and optional **images**. You can try it in a browser with the theme kit (section 7) and hand the files over; we wire them in. There is no JavaScript in a theme.

## 1. How a theme is applied

When a theme is chosen, the app:
1. sets the palette values below as CSS variables on `<html>`,
2. sets `data-theme="your-id"` on `<html>`,
3. sets `color-scheme` to light or dark from the palette's `mode`.

Your CSS layer is then just rules scoped to that attribute, for example `html[data-theme="your-id"] .card { ... }`. Write every rule with that prefix, so it only applies to your theme, and mark the visual ones `!important` (the built-in rules in the app are strong; the existing themes do the same).

## 2. The palette

One JSON object per theme. This is the existing default theme, as the shape to copy:

```json
"your-id": {
  "mode": "dark",
  "bg": "#05040c",
  "panel": "#070a1a",
  "fg": "rgba(241, 245, 249, 0.95)",
  "dim": "rgba(148, 163, 184, 0.92)",
  "line": "rgba(46, 242, 255, 0.38)",
  "accent": "#2ef2ff",
  "accent2": "#ff3bd4",
  "onAccent": "#04121a",
  "radius": "10px",
  "page": "linear-gradient(180deg, rgba(5,4,12,.55), rgba(5,4,12,.96)), url('themes/your-bg.jpg') center top / cover no-repeat fixed",
  "pageColor": "#05040c",
  "label": "Your Theme Name",
  "icon": "🎨"
}
```

| Field | What it is |
|---|---|
| `mode` | `"dark"` or `"light"`. Controls the browser's own scrollbars and form controls. |
| `bg` | The base page colour. |
| `panel` | Panels and the header. Cards and inputs are mixed from `panel` and `bg`. |
| `fg` | Main text. |
| `dim` | Secondary text (subtitles, labels, hints). |
| `line` | Borders and dividers. Usually a translucent accent. |
| `accent` | The main highlight: active tab, buttons, progress bars, links. |
| `accent2` | The second highlight: gradients, badges, hover glows. |
| `onAccent` | Text drawn on top of `accent` (must be readable on it). |
| `radius` | Corner roundness of cards and boxes. |
| `page` | The background of the whole window: a colour, a gradient or `url(...)`. It is drawn once, fixed behind everything. |
| `pageColor` | A solid colour shown behind `page`. |

The app also derives these from the above, so you can use them in your CSS: `--surface` (panel, 80% opaque), `--inset` (input and well backgrounds), `--inset2`, `--card2`. The full list of variables is `--bg --panel --fg --dim --line --accent --accent2 --on-accent --rc --page --page-color --surface --inset --inset2 --card2`.

An optional `"vars": { ... }` object can add your own `--names` for your CSS to use (the existing themes carry things like `--accent-rgb`, `--glow-strong`, `--shadow`; copy what you need).

## 3. What is on screen (the structure you are styling)

```
html[data-theme]
└ .shell                          the whole window, a column
  ├ .banner                       the big title strip at the top of EVERY page
  │  ├ .header-stars (.header-star)   small decorative stars
  │  ├ .banner-actions            buttons, the theme drop-down (select.themesel), Logout
  │  ├ .banner-credit             "Created by..." with .fire-particles (.flame)
  │  ├ img.banner-logo            the skull logo
  │  └ .banner-text               h1 "ARMGDDN BROWSER" and p "Secure Multi-Remote Game Browser"
  ├ header.topbar                 the tab bar: .tab buttons (Home, a nav of library tabs, Tools, Settings, Wiki, My List, Requests, Downloads); .tab.on = current; .badge = the small count
  ├ .subbar                       Back / Forward (.tab.backbtn), the page title (.subtitle), search (.search), drop-downs, Grid / List (.viewsel)
  ├ .notice / .notice.soft        information boxes (for example the 3D models note)
  ├ .crumbs                       the path above a list, with .count
  └ the page itself (one of):
     • Home        main.home with .strip sections (.strip-head, .strip-title, .strip-sub, .strip-note) holding rows (.hrow) of cards
     • Library     main.grid (cards in a grid) or main.list (.lrow lines)
     • Settings    .settings > .sgroup (h3) > .srow (.slabel, .sval, .dbtn buttons, inputs)
     • Downloads   .dlist > .drow: .dname (.dstat), .bar > .fill, .dmeta, .dfiles (.dfhead, .dfile: .dfname .dfsrc .dfpct .bar.small .dfspeed), .derr, .dbtns > .dbtn
     • Wiki        .wikitoc (the list on the left) and .wikibody (the text)
```

A game card:

```
.card
├ .cover            the picture area (img.cbg the blurred background, img.cfg the sharp art, .nocover when there is none)
└ .meta
   ├ .title         the name (two lines at most); may hold .vbadge (Newest) and .pbadge (PC / PCVR)
   ├ .sub           year, size, downloads
   └ .cbtns         .dl buttons: .dl.heart (My List), .dl.ghost (Browse, Details), .dl (Download)
```

Other things worth styling: `.search`, `select`, `button.dbtn`, `button.primary`, `.chip`, `.toast`, `.modal`, `.loading`, `.warn` and `.ok` text, scrollbars (`::-webkit-scrollbar`).

Please do **not** change sizes, padding or layout of `.tab`, `.topbar`, `.subbar`, `.grid` or `.shell`. The narrow-window layout depends on them. Colours, backgrounds, borders, shadows, radius, fonts and decoration are all yours.

## 4. Fonts and images (limits)

- **No web fonts and no links to the internet.** The app only allows its own files. Fonts you can use by name: Audiowide, Barlow Condensed, Chakra Petch, Cinzel, Cormorant Garamond, DM Serif Display, EB Garamond, Figtree, Fredoka, IBM Plex Mono, JetBrains Mono, Karla, Lora, Manrope, Nunito, Orbitron, Outfit, Playfair Display, Press Start 2P, Quicksand, Rajdhani, Righteous, Share Tech Mono, Sora, Space Grotesk, Teko, VT323. If you want another font, tell us and we will add it.
- **Images** must be files we ship with the app (put them in `themes/`, refer to them as `url('themes/name.svg')`) or `data:` URIs. SVG is best (small and sharp). Keep each file under about 200 KB; photos as JPG.
- Animations are fine. Please keep them gentle and make them stop under `@media (prefers-reduced-motion: reduce)`.

## 5. Examples to read

The existing themes show how far a layer can go. Open `themes.css` and search for `blood-moon` or `forest-ghost`: each restyles the header, the banner, the search box, the cards (shape, hover, glow), the strips, and the heading fonts. The built-in ones are listed here, so avoid their ids: dark, 8bit, aurora, blood-moon, bubblegum, copper-forge, desert-dusk, forest-ghost, glacier, graphite, light, midnight-ocean, mocha-mint, neon-alley, nordic-frost, oldskool, parchment, phosphor, royal-gold, sage, sakura-night, solar-flare, tropic, vaporwave, void.

## 6. What to hand over

1. `your-id.json`: the palette object from section 2.
2. `your-id.css`: your layer, every rule starting with `html[data-theme="your-id"]`.
3. Any images, with their file names matching the `url('themes/...')` in your files.
4. One line each: the name, a short description of the idea, and light or dark.

## 7. Preview your theme (the theme kit)

We give you a folder, `theme-kit`. Open `preview.html` in any browser: it shows a sample Home page, a library page with covers, Settings, Downloads and the Wiki, built with the same markup and CSS as the app. At the bottom right, **Load your palette (.json)** and **Load your CSS (.css)** try your own files without changing anything else. Put your own images in the kit's `themes` folder. To see the narrow layout, make the browser window narrower than 900 px.

## 8. Check these before you send it

Home, a library page with covers, Settings, Downloads and the Wiki. Look at: text readable on every background (body text and `.sub` especially), the active tab clearly different from the others, hover states on cards and buttons, and a narrow window (the tabs wrap onto two rows). A good theme still reads well with the brightest cover art on a card.
