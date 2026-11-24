# ARMGDDN App: best practices checklist

Adopted Nov 24 2026. The ARMGDDN App is a website inside a desktop window, so it follows the same rules a good public website does.
Every rule below is checked in one of three ways:

- **Test**: `test/bestPractices.test.js` (and the tests named next to the rule). It runs with `node --test test/*.test.js`, so a change that breaks the rule fails before a release.
- **Page check**: `tools/preview/page-check.js`, run on the preview page before each release (see "Before each release").
- **Review**: checked by a person when the change is made.

When a rule has to be broken on purpose, write why next to the code and in the test's exception, never silently.

## 1. Security

| Rule | Checked by |
|---|---|
| Every window: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` | Test |
| No window opens another by itself: `denyNewWindows(win)` (the sign-in window allows only Telegram's login popup, oauth.telegram.org) | Test |
| Windows cannot navigate away from their own pages (`will-navigate` blocked or limited to armgddnbrowser.com) | Review |
| The page's content security policy allows no inline scripts and no `eval`, no plugins, no `<base>` | Test |
| Links to other sites open through `shell.openExternal` with an allow-list, never inside the app | Review, `test/nativeSecurity.test.js` |
| Pictures from other sites are fetched by the app with limits (no private network addresses, time, type and size caps) | `test/nativeSecurity.test.js` |
| Libraries shipped in the app have no known security advisories (`npm audit --omit=dev` shows 0) | Review before each release |
| No retired project left in the repo (it keeps old libraries with advisories alive) | Test |

## 2. Accessibility (WCAG 2.1 AA)

| Rule | Checked by |
|---|---|
| Every picture has `alt` (`alt=""` when it only decorates, e.g. a cover inside a labelled card) | Test |
| Every text box, menu and checkbox has a label (`<label>`, `aria-label`, or `title`); a placeholder alone is not a label | Test |
| Every button has a name; a button showing only a symbol (♥, ×) has `aria-label` | Test |
| Nothing is click-only: anything clickable is a button or link, or has `tabIndex` and answers Enter and Space (`kbdClick`); parts of a card the card itself opens carry `data-kbd="card"` | Test |
| The keyboard can do everything: arrow keys between cards, Enter opens, / searches, Esc goes back or closes a window, and focus shows a ring | `test/sharedPageHelpers.test.js`, Review |
| Progress bars have `role="progressbar"` and `aria-valuenow` | Test |
| Changes a screen reader should hear are in a `role="status"` region (messages, download steps), without reading every percent | Review |
| Text contrast at least 4.5:1 (3:1 for large text), in every theme | Page check |
| Animations stop for people who ask for less motion (`prefers-reduced-motion`) and for Animations off | Test |
| Headings in order (one h1, then h2, h3) and the page language set | Page check |

## 3. Performance

| Rule | Checked by |
|---|---|
| No single page file over 1.5 MB (sounds as Opus `.ogg`, pictures as JPEG/WebP at the size shown) | Test |
| Every font face has `font-display` | Test |
| Long lists skip cards that are off screen (`content-visibility: auto` with a `contain-intrinsic-size`) | Review |
| Pictures load lazily (`loading="lazy" decoding="async"`), covers at the width shown (`&w=`) | Review |
| Nothing animates forever; animations pause while the window is hidden | `harbor` tests, Review |

## 4. Reliability

| Rule | Checked by |
|---|---|
| A page that throws shows "This page ran into a problem" with Back, never a blank window (`PageGuard`) | Review |
| Every state the main process gives a download is in `DOWNLOAD_STATES`; an unknown one shows as running | `test/downloadStates.test.js` |
| No errors in the console on any preview page | Page check |
| Every list has a loading, an empty and an error state | Review |

## 5. Privacy

| Rule | Checked by |
|---|---|
| Crash reports need the member's answer: asked once (first start, or first start after the update that added it), remembered in `errorReportingAsked`; changeable in Settings | Test |
| Reports never carry the member's IP, name, Telegram account, home folder or link tokens (`scrubForSentry`, `sendDefaultPii: false`); a failed download's report names the title | Review |
| Whatever the question tells members a report contains must stay true; change the question when the reports change | Review |
| The install ID (deviceId.js) is random, made on first use, and only its SHA-256 fingerprint is sent (X-ARMGDDN-Device); it reads nothing about the PC | `test/deviceId.test.js`, Review |

## 5b. Words members see

| Rule | Checked by |
|---|---|
| The app is "ARMGDDN App" everywhere a member can see it, never "Companion" (the name stays only in code, file names and Sentry ids) | Review |

## Before each release

1. `node --test test/*.test.js` passes (the guards above included).
2. `npm audit --omit=dev` shows 0.
3. `PREVIEW_HOST=<this machine's tailscale address> npm run preview`, then open `preview.html?scene=<home|library|downloads|settings>` with `&theme=classic` too, and run `tools/preview/page-check.js` on each. Every count is 0 (or each one left is explained in the release notes).
4. Look at the Downloads scene: one download in each state.
