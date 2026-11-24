# Splitting main.js

main.js held the whole main process in one file (10,120 lines on Nov 24 2026). It is being split into modules under `main/`, the way
the website's server.js was split into routes/, lib/ and services/. Approved by George on Nov 24 2026 ("Step 4").

## Rules

- **Moves only.** A function moves with the comment lines above it, unchanged. main.js requires it back under the same name, so no caller changes.
  Behaviour changes are separate commits on `main`, never mixed into a move.
- **Dependencies decide the order.** `node tools/split/deps.js --acorn <path to acorn>` lists every top-level function with the shared state,
  other main.js functions and required modules it uses. A function that uses no shared state and no other main.js function moves as is.
  The rest move later, with their state passed in or moved alongside.
- **Every step is proven** before it is committed:
  1. each moved function's text is identical to the original (`git show HEAD:main.js`);
  2. `node --test test/*.test.js` passes (tests that read the main-process source use `test/mainSource.js`, which joins main.js and main/** with the `ctx.` prefix undone, and
     `mainSource.fn(name)` for one function's own text: slicing from one function to the next breaks once they live in different files);
  3. the app's own start-up test passes for real, under a virtual display:
     `ARMGDDN_SMOKE_TEST=1 ARMGDDN_SMOKE_RESULT=<file> xvfb-run -a ./node_modules/.bin/electron . --no-sandbox` prints `[smoke] PASS`
     (link the system rclone to `rclone/rclone` first; it is git-excluded);
  4. `node tools/split/undef.js --acorn <path>` finds no name a module uses without defining it (added after step 6 nearly moved a default
     parameter, `ttlMs = MIRROR_COOLDOWN_MS`, without rewriting it; the text proof cannot see that).
- **Location-dependent code** is the trap the text proof cannot see: the same words mean something else in main/. `__dirname`/`__filename`
  go through the context (`ctx.__dirname`), and a `require('./x')` inside a moved function becomes `require('../x')`; movectx does both and
  its proof undoes them. Step 8's smoke test caught the window loading main/preload.js; the same fault was then found in the app icon
  (step 2), the Komga prompt, What's New and the install-screen logo (step 7), and four inline requires (Linux notifications, the window
  freeze watch, download speed estimate, engine reason), two of them inside try blocks that would have failed silently. Guarded by
  `test/mainModulesNoDirname.test.js` and `test/mainModulesRequirePaths.test.js`.
- **Before this branch is merged:** the start-up smoke test does not run the app's own download path (it downloads through rclone directly),
  so the scheduler and downloader moves must be checked with real downloads in a built app: one game, a multi-file batch, pause and resume,
  a cancelled download, and an update while a download is paused.
- No circular requires between main/ modules: a cycle hands a module an unfinished copy of another, so a function is undefined at run time
  (`test/mainModulesNoCycles.test.js`).
- `main/**/*` is in package.json build.files; `test/packagedFiles.test.js` fails if a required module would be left out of the installer.
- The work is on branch `refactor/split-main` (worktree `../ArmgddnCompanion-split`), rebased on `main` before each step. Nothing ships until
  George decides; then it goes out in a normal release.

## Tools

- `tools/split/deps.js`: the dependency map.
- `tools/split/move.py <module> <function>... [--auto-requires <path to acorn>] [--doc "..."]`: moves functions, writes the module's
  requires (refusing a function that uses shared state or another main.js function), and adds the require line to main.js.

## Progress

| Step | Module(s) | Functions | main.js lines after |
|---|---|---|---|
| 1 | util | 15 stateless helpers (sizes, speeds, times, versions, safe paths, quoting) | 9,966 |
| 2 | errors, sevenZip, files, net, updateCheck, downloadState, windows | 50 that use no shared state | 9,198 |
| 3 | log | the debug log: getDebugLogPath, logToFile, debugLog and their private state | 9,148 |
| 4 | sevenZip, platform, downloadState, komgaConfig, auth, files, errors, net | 17 freed by step 3, plus rotateLogIfNeeded into log (it made log and files require each other) | 8,744 |
| 5 | context, settings, session, history | first moves that use shared state (settings, sessionToken, downloadHistory), through main/context.js | 8,516 |
| 6 | mirrors, scheduler | mirror cooldowns; the download scheduler (which file starts next, how many at once) | 8,157 |
| 7 | updates, hashing, komgaActions, deepLinks, quietHours, restore, dialogs, siteApi, failures, extract, installSpace | 53 functions in 11 groups | 6,808 |
| 8 | progress, manifest, completion, downloadControl, downloader, appWindows, comics | the download engine (downloadFile, 1,187 lines), the windows; getAppLoadInfo and comicsGet stay (a local sessionToken shadows main.js's) | 3,263 |
| 9 | ipcKomga, ipcSettings, ipcCollections, ipcHelp, ipcDownloads, ipcApp | all 60 IPC handler registrations (`tools/split/moveipc.js`; register() called where the last one stood) | 1,331 |
| 10 | smokeTest, sessionAsync, supportText | the app's own start-up test and two small helpers | 1,114 |

## Shared state (from step 5)

`main/context.js` holds live getters and setters that main.js registers once (`require('./main/context').provide({...})` near the top).
`tools/split/movectx.js` moves a function that uses shared state: each reference to a name that stays in main.js becomes `ctx.<name>`,
nothing else changes, a function whose local names shadow one of those is refused, and undoing `ctx.` must give back the original text
exactly. `test/mainModulesLoad.test.js` loads every module with Electron stubbed and fails when a module (or main.js) asks for a name that
is not exported.

## What stays in main.js

The start-up sequence (Sentry, single-instance lock, app.whenReady, timers, quit handling), the shared variables, the context registration,
and two functions the tool refused because a local name shadows a shared one (getAppLoadInfo, comicsGet). main.js is now the app's
wiring: what starts, in what order, and the state everything shares.

## Next (older plan, kept for reference)

What is left uses shared state: settings, the windows, the session token, activeDownloads, the scheduler. Planned order:
logging (logToFile and friends), settings load/save, session, mirrors and the download scheduler, the downloader (downloadFile is about
1,200 lines and gets its own folder), updates, IPC handlers, windows/tray/menu, and last the start-up sequence that stays in main.js.
Each needs a small shared-state module (`main/state.js`) or its state passed in; that decision is made per step.
