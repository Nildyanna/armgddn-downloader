# Native browser preview (staging branch `native-ui`)

Status as of 2026-11-18. Nothing here is released or deployed. The live site and the released Companion (5.22.2) are unchanged by this work.

## What it is
A second window inside the Companion that replaces the website: browse, search, details, trailers, downloads, requests, My List and the Wiki, all
built into the app. It opens only when the app starts with `--native`; without the flag nothing in the app changes.

- `native/bridge.js` (main process): all site calls (token never reaches the page), covers through `armgddn-img://`, downloads through the same
  token + deep-link path the website uses, requests, README, links (https allowlist).
- `native/apiClient.js`: at most 6 calls at a time, GET cache, 429/5xx retries, image cache.
- `native/vendor/`: Preact, htm, hls.js (no build step). Licenses beside them.
- `renderer/native/`: `app.mjs` (screens), `format.mjs` (pure helpers, all tested), `native.css`, `wiki.json` (copied from the site by `scripts/extract_wiki.py`).
- `preload-native.js`: the only things the page can call.
- Tests: `test/native*.test.js` (19 pass). Run: `node --test test/native*.test.js`.

## Built
Browse (PC, PCVR, Testing, Apps, 3D, Comics, Music) with landscape / square / portrait cards, covers, A-Z jump, sort, category/genre filter, search this list and
search everywhere. Card buttons: heart, Browse, Details, Download. Cover click = trailer (direct video, Steam streaming, YouTube) or the full cover.
Details window (cover, facts, categories, Steam links, trailer, README). Downloads: README notice, bandwidth notice (once a day), PC Apps notice, update-patch
question, Starfield prompt, batch download without patches, Downloads tab with pause/resume/cancel/retry. Requests (My Requests, comments, new Music/Comics
request), `armgddn://request/<id>` deep link. My List (kept on this device). Wiki. Export list (CSV or Excel, saved through a save dialog; the site builds the file). Settings screen (folders, simultaneous downloads, connections, speed limit, check/extract, tray, updates; the rest opens the classic window).
Hidden like on the website: stray `.json` files, folder echoes, Testing strays, dot-folders.

## Not built / not proven
- **Writes to the live site are unproven.** Request comments are blocked by CSRF for the Companion, and a Companion login has no username, until the staged
  site change (branch `native-companion` in `ArmgddnBrowser-native`, commit `9af58aae`) is deployed. Reads work today.
- Members' website My Lists do not carry over (the site keeps them in the browser).
- Tools tab (2026-11-18): "only what I'm missing" for Comics and Music (pick folder, scan with live count, compare with the library or one reading order, download the rest)
  and Komga (address and API key, add a reading order as a read list, import the key from the installed Companion). They call the same main-process code as the classic window.
  Tested on the PC: the Comics scan and compare against the live library list (read only), the Komga key import. NOT run: "Download what I'm missing" (it starts real downloads),
  a Music scan (the imported Music folder is N:\\). "Add to my Komga" builds the list from the site's catalog (the way the pipeline identifies comics), not from the .cbl: each comic is found by its exact file (name + size, folder path as tie-break), then by Comic Vine id, never by series name. Verified on 2026-11-18 against a real Komga 1.28: Daredevil (441) and Batman (2,877) came out book for book, in order, identical to the member's own "! ... - Suggested Reading Order" lists, all matched by file; the test lists were deleted afterwards. komga.js also still handles Komga 1.28's answer to the .cbl match call (candidates per issue) for the classic window.
- Direct-from-Drive end report (2026-11-18): the app tells the site how much of a grant was not downloaded when a download is cancelled, completed, or finally failed (no automatic retry waiting); a paused download sends nothing. A later report only adds the files finished since (the site credits once). Covered by unit and source tests; not yet seen in a real failing download.
- Themes and their fonts: 27 Google Fonts families (latin woff2, 0.8 MB) are bundled in `renderer/native/fonts` (made by `scripts/get_fonts.py`), so themes look right offline.
- Not copied: the public status page, game requests (closed), mobile, the remaining classic-window tools (history, schedule; reachable through Settings).
- Wiki text is the website's. Sections 2, 8, 11, 12, 13 describe the website flow and need rewriting for the app (Wiki edits need approval).
- Tested from this window on 2026-11-18 (Windows): pause holds the byte count and resume finishes with every file checked; cancel removes the partial files (an empty folder is left); a download paused for 11 minutes, past the 10 minute link life, resumed with fresh links and finished checked. Not yet tested: a very large (tens of GB) download, closing the app mid-download, Linux and macOS. Steam HLS trailers are untested (direct video and YouTube were).
- The Companion's own test suite cannot run on the build server (it cannot open a local test port); CI runs it on tag.

## Running the preview on the PC (dev)
Copy of the branch lives in `D:\native-ui-test` with its own profile (`profile\`), so the installed Companion is untouched. The preview does NOT register
`armgddn://` (a bug where it did was fixed on 2026-11-17; the installed Companion's registry value was restored).
Launch: `electron.exe . --native --user-data-dir=D:\native-ui-test\profile`. Options for checking the layout without watching: `--native-shot=<png>`,
`--native-tab=<tab>`, `--native-click=<css>>>><css>`, `--native-eval=<js>>>><js>`, `--native-scroll`.
To remove: close the window and delete `D:\native-ui-test`.

## Before it can ship
1. Deploy the staged site changes (CSRF exemption for the Companion except admin routes, username on the Companion login).
2. Decide the forced-update date; release as a minor (new window) or major (the website becomes info-only).
3. Rewrite the Wiki for the app (needs approval); build the public info page for the site; keep the admin panel on the web.
4. Test on Windows, Linux and macOS builds; add the packaged-files entries are already in `package.json`.
