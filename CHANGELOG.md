# Changelog

All notable changes to ARMGDDN Companion will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Dark, Light and System are viewing modes with their own menu, next to the theme menu. The theme menu lists only the themes for the mode on screen, and each mode remembers its own theme (Harbor and Light by default). System follows the computer's light or dark setting and switches between the two picks when it changes. A theme saved before this becomes its mode plus that theme (renderer/native/themeMode.mjs).
- Settings: the "New to .7z files?" video starts playing as soon as Watch the video is clicked, and sits centred in its row.
- Downloads: the step bar shows only the steps a download goes through: no Check when Check files is off or there are no checksums, no Unpack for a .zip, a Comics download, or with Auto-extract off. The Finished list says only what was done ("checked and extracted", "checked", "extracted", "check found damaged files and not extracted"), and nothing for older records. main.js records the plan (finishPlan) and what happened (didCheck, checkOk, didExtract), also in history.

### Fixed

- Downloads: finished titles lost their cover art once they left the live list; history rows now keep the library path and section the art is found by.

### Added

- Badges: a secret badge you have earned gets a gold card with its rarity ("✦ Secret · Legendary"), without numbers.

## [6.10.2] - 2026-11-24

### Fixed

- Windows: a desktop or Start menu shortcut that showed a blank icon after an update. On the first start after an update (or after a shortcut rename) the app writes its shortcuts again with its own icon and asks Windows to redraw icons (ie4uinit -show).

## [6.10.1] - 2026-11-24

### Internal

- A random install ID (deviceId.js); the API client sends only its SHA-256 fingerprint (X-ARMGDDN-Device).

## [6.10.0] - 2026-11-24

### Added

- A step bar on every download: Download, Check, Unpack, Ready, with the step it is on lit (a check or unpack that was skipped is marked).
- Keyboard: the arrow keys move between cards, Enter opens the card, / jumps to the search box, Esc goes back (or closes a window), and the card in focus shows a ring.
- The app asks once whether to send crash reports (on the first start after this update, and on a new install), and remembers the answer. It stays changeable in Settings.
- Screen readers: every text box and menu has a label, progress bars say their percent, and messages and download steps are read out.

### Fixed

- A game being checked or unpacked after its download stays at the top of Downloads ("checking every file" / "Unpacking 45%") instead of being listed under Waiting as "starts when a slot frees up".
- The size done and "Left" match the percent when several files download at once (32% showed "504 MB of 39.6 GB").
- The speed at the top of Downloads uses the unit picked on the cards (Mbps or MiB/s).
- The Downloads count in the menu is easier to read (darker bubble) in every theme.
- Request rows, the trending list and the Home banner picture can be opened from the keyboard.
- The update window and the Settings import line said "Companion"; they say ARMGDDN App.

### Internal

- One list of download states for the pages, with a test that fails when the main process uses a state the list does not know.
- `npm run preview` shows the pages in a browser with made-up data (one download in every state) for checks before a release.
- docs/BEST_PRACTICES.md: the app follows common website practice (security, accessibility, performance, reliability, privacy); test/bestPractices.test.js guards the rules, tools/preview/page-check.js checks drawn pages before a release.
- Every window is sandboxed and cannot open other windows (the sign-in window allows only Telegram's login popup).
- Long library lists skip drawing cards that are off screen.
- The login sound is Opus (0.46 MB) instead of a 4.8 MB WAV.
- Removed the retired Android app's folder (mobile/), which carried 22 of the repo's 24 security alerts.

## [6.9.1] - 2026-11-24

### Fixed

- Tracks inside a Music album show the album's cover instead of a placeholder letter (a CD1 / Disc 2 folder uses the album's cover).

## [6.9.0] - 2026-11-24

### Changed

- Harbor is now the default look for everyone (it was a staff test): wide art, cleaner pages, a redesigned Home, Library, Downloads and title page. Members on the old default switch to it once; the old look is still in the theme menu as Classic, and Light, System and other themes stay as chosen.
- A comic collection's or album's page shows its cover (the same picture as in the library), shaped to fit: tall for comics, square for albums. It used to show only the first letter. Comics and Music pages no longer show the game install steps or "New build".
- Updating happens inside the app: the download and checking show in the app's own window instead of a popup, and while the app is closed for the install, a screen in the app's colours, size and place (logo, version, moving bar) replaces the grey Windows box. The new version opens where the old one was.

## [6.8.0] - 2026-11-24

### Changed

- Harbor theme (staff test): fits wide screens (more columns, content centred on very wide windows), no animations that loop forever, Library and My List redesigned to match Home and Downloads, and the Downloads page scrolls on its own instead of squeezing the bars above it. Harbor's Downloads page now has the Mbps / MiB/s switch and the files-at-once list like the classic one.
- Animations pause while the window is minimised or hidden (every theme).

### Fixed

- PCs where the app kept closing at start with "GPU process isn't usable" even after switching to software drawing: if it still fails in software mode, the next launches run with no graphics process at all for a week (Sentry ARMGDDN-COMPANION-2Q).

## [6.7.0] - 2026-11-24

### Changed

- The app is now called "ARMGDDN App" (it was "ARMGDDN Browser"): window title, header, tray, update notices, login window, Settings text and the Wiki. The desktop and Start Menu shortcut renames itself, and a shortcut named "ARMGDDN Browser" moves to the new name. Installer, install folder and update channel are unchanged, so nothing needs reinstalling.

## [6.6.1] - 2026-11-23

### Fixed

- My List showed "This page ran into a problem" for anyone with a saved game (a wrong variable name since 6.4.0). It draws the list again.
- Admin: the Overview's two groups of stat cards no longer touch each other.

## [6.6.0] - 2026-11-23

### Added

- Badges page: every badge as earned, locked (what it takes and your progress) or hidden (secret until earned), a progress bar toward Badge Collector Supreme, and "Wear this" to choose which earned badge shows next to your name.

## [6.5.0] - 2026-11-22

### Added

- Admin: changing a request's status now has an optional reason box. The reason is sent with the change; for Approved and Rejected it also appears in the member's thread.

### Changed

- The install guide's last step is now "Install and play": install from the extracted folder, then start the game from the desktop or Start menu icon, with VR instructions (headset launch method of choice, not Steam Link, then the desktop view).

## [6.4.7] - 2026-11-22

### Fixed

- On some Linux setups the app could fill its log with endless "write EPIPE" errors after being started from a launcher that closed its output. A closed output is now ignored, and the same error is no longer reported to Sentry.

## [6.4.6] - 2026-11-22

### Added

- Harbor (staff test theme): calm motion that carries meaning: the hero and the ranked rows fade in, the hero cover drifts slowly, a short firework celebration plays over the No. 1 title once per visit to Home, downloads fill in smoothly with a pulsing leading edge, cards lift on hover, the game page and the other cards fade in. It all stops when Animations is off or Windows asks for reduced motion. The "Created by Old Man of the Hills" credit line is back beside the name, without the flames.

### Changed

- Admin: the Zip Jobs line is removed from the API stats (zip jobs are no longer made).

## [6.4.5] - 2026-11-22

### Fixed

- Harbor (staff test theme) only showed for site owners and admins, so most staff never saw it. It now shows for every current staff member (the list Tulip keeps on the site); the site's preferences answer says whether the member is staff. Anyone else who had it saved goes back to the Default theme.

## [6.4.4] - 2026-11-22

### Fixed

- Harbor (staff test theme): a title in the Most downloaded chart that has no art now shows a letter tile (as the library does) instead of an empty block.

## [6.4.3] - 2026-11-22

### Fixed

- Harbor (staff test theme): a trending title that comes without art (mods and non-Steam titles) showed an empty picture on Home. The art is now read from the library listing when the trending list has none.

## [6.4.2] - 2026-11-22

### Changed

- Harbor (staff test theme): a game's Details is now a full page (cover and facts on a tinted top, Getting it running, Also big in VR or PC for the same kind of title, from the last 30 days). The Downloads page has a heading with speed, what is left and when it will be done, art cards that fill in as they download, and Waiting and Finished lists. Art is read from the library listing as needed.

## [6.4.1] - 2026-11-22

### Changed

- Harbor (staff test theme): Home rebuilt to follow the design: a hero for the most downloaded title of the last 30 days (counts from that window only, never all-time), a three-column ranked chart with covers, fresh builds, and a Downloading now strip. Cover art keeps the app's own fitting instead of being cropped (library, hero and Downloads cards). Downloads cards find art for every section. The open tab no longer shows a white focus box; keyboard focus gets a soft green ring. Admin cards have more room.

### Fixed

- The item count in a library list no longer counts hidden files (it read "1163 of 1164 items" when one hidden update file was in the folder).
- Admin: the value labels above the bars in the hour-of-day and other dense charts no longer overlap (every third bar and the peak are labelled; hovering still shows every value).

## [6.4.0] - 2026-11-22

### Added

- Harbor, a staff-only test theme for a possible new default look: flat dark surfaces, Archivo type, art-first cards, one green accent. Home gets a lead block (the top title of the last 30 days, a ranked "Most downloaded" chart, and what is downloading now). Downloads shows active downloads as art cards whose picture fills in as they progress; the art is read from the library listing when needed, not saved. Settings, Tools, Wiki, Requests and Admin follow the same style. Other themes are unchanged.

### Fixed

- When the site refuses a saved sign-in (401), the app signs out and shows the sign-in screen with "Your sign-in expired", instead of an empty Home.

## [6.3.3] - 2026-11-22

### Fixed

- Sign-in: the site finishes a Telegram login on the page itself, with no reload, so the app's checks (on page load and navigation) never saw it and the sign-in window stayed open with the app locked behind it. The app now checks every 1.5 seconds while the window is open, and on in-page changes, with a guard against two token requests at once.

## [6.3.2] - 2026-11-21

### Fixed

- Signing in with a different Telegram account: the sign-in window shares the app's browser session, so after signing out the old account's login cookie and Telegram's own account cookies stayed, and the next sign-in signed itself straight back in as the old account and closed. Signing out, and signing in with no saved sign-in, now clear those cookies (the site's themes and settings are left alone). Reported by Darkheart V3.

## [6.3.1] - 2026-11-21

### Fixed

- Admin colours: the group chips no longer clash with an older style (they were indented and sized differently), long group names are chips too, Testing is no longer shown as a warning, and a table column is either fully coloured or plain, with odd values in a coloured column shown as a grey chip of the same shape.

## [6.3.0] - 2026-11-21

### Added

- Admin and owner reports use colour where it means something: green, amber and red for status words, failure counts, errors, load, queue and streams.
- Roles, categories and sections get stable group colours, and admin tabs and report panels carry their own accent.

## [6.2.1] - 2026-11-21

### Fixed

- Downloading a whole music artist, or several albums at once, saved every file flat in one folder. Artist and album folders are now kept, and a batch from one artist is named after the artist. Reported by Dirk.

## [6.2.0] - 2026-11-21

### Added

- Small text files (README, NFO, TXT, LOG, INI, CFG and similar) in a folder now show a Read button instead of Download and open inside the app. Full-folder downloads still include them. Suggested by Delicious Meatpop.

## [6.1.2] - 2026-11-21

### Fixed

- After pressing Search all sections, the Everywhere box stayed on and clicking a section tab (for example PC Games) kept searching everywhere while the tab looked selected. Section tabs and Go links now turn Everywhere off, and no tab is highlighted while it is on. Reported by Dirk.

## [6.1.1] - 2026-11-21

### Fixed

- The Downloads tab showed a size that did not match the percentage while a download ran (for example "32% · 3.9 MB of 43.4 GB"), because it only counted files that were already finished. It now counts what has been written so far, so the size and the percentage agree.

## [6.1.0] - 2026-11-21

### Added

- The Downloads tab shows the time elapsed next to the ETA for a download that is running, and the total time for one that has finished.

### Fixed

- Cancelling a download no longer leaves an empty folder behind. The folders it made are removed once they are empty; a folder that still holds anything (including files that were there before) is never removed.

## [6.0.3] - 2026-11-21

### Fixed

- The Minimize button now hides the window to the tray when "Minimize button hides the window to the tray" is on. The setting did nothing in the new window.
- "Start minimized" now works in the new window: when the computer starts the app at login, it goes to the tray (or the taskbar) instead of opening in front.

### Changed

- The two tray settings are worded more clearly: "Minimize button hides the window to the tray" and "Close button keeps the app running in the tray (off: closing quits the app)".

## [6.0.2] - 2026-11-21

### Fixed

- Closing the window now ends the app when "Keep running in the tray when the window is closed" is off. Before, the app stayed running with no window, and clicking its tray icon brought up the old Companion window. The old window can no longer be shown at all, by the tray or by opening the app a second time. When downloads are running, closing still asks before quitting.

## [6.0.1] - 2026-11-21

### Fixed

- The theme name in the header is no longer cut off (Midnight Ocean lost its last letter behind the dropdown arrow).

## [6.0.0] - 2026-11-21

### Changed

- ARMGDDN Browser is now one app. Browsing, search, covers, requests, My List, the Wiki, settings and downloads all live in this window, and it is the only window. The website is now an information page: what ARMGDDN is, how to get the app, how to join the channel and the site status.
- Every download for the whole library (games, 3D models, apps, Comics and Music) comes straight from Google Drive, tagged Drive in the Downloads tab. The old route through the download gateway is no longer used by the app. Over a limit, or when Google Drive does not answer, the app says so and how long to wait.
- Version 6.0.0 is a required update. Older versions stop downloading until they update (Settings, Updates, Check for updates).
- The app's built-in engine is updated to Electron 45.4.1 with the latest Chromium and Node security fixes.

### Removed

- The setting "Open this native window when the app starts", the "Open the classic window" button, and the "Switch to the classic window" entries in the File menu and the tray menu. The old window can no longer be opened.

## [5.43.0] - 2026-11-21

### Changed

- Admin Requests (owner and admins): the list is now cards with the same details as the website: popularity flame, NEW or UPDATE, the possible-game flag, who asked and how many others, the existing folder, the Steam link, notes, decision reason and the unseen-comment count. Added Send requester link, Copy /warn (on possible game requests) and, for the owner, Delete (with a confirmation). An "Unseen comments" button shows only the requests with comments not yet seen, with the total on it.

## [5.42.3] - 2026-11-20

### Changed

- Admin Requests: the first entry of a request's comment thread now shows everything in the request (link, Steam app, type, notes, who asked, staff notes), not just the summary row.
- Admin access lists: the box now chooses which list the table shows (with the number of people on each), and Add puts the new id on that same list. Before, the table always showed both lists together.

## [5.42.2] - 2026-11-20

### Changed

- Animations pause while the window is minimised, hidden or not in front, and the classic window's progress bar no longer shimmers endlessly, which kept the graphics card busy during a download.
- New Settings option "Lighter graphics" (both windows) turns off blur effects and animations.

## [5.42.1] - 2026-11-20

### Fixed

- A download that was cut off by the app closing now tells the site its Drive grant ended, when the app starts again or when you press Resume or Cancel on it, so the part not downloaded is credited back to the daily allowance. Before, it stayed charged for 24 hours.
- The Go there button on a stub game folder opens the other section filtered to that game, not its root.

## [5.42.0] - 2026-11-20

### Added

- Admin Requests: a Comments button opens the request's thread so staff can read and add comments.

## [5.41.8] - 2026-11-20

### Changed
- In shorter windows the covers shrink and grow with the window height, and scrolling the list settles on a whole row instead of stopping mid-cover.
- In the very smallest window, titles show as compact tiles with a small cover beside the name and buttons, so several fit on screen at once.

## [5.41.7] - 2026-11-20

### Fixed
- In small windows the title strip and bars are more compact, so the list has more room; the Music and Comics notices and the Komga box take less space too.

### Added
- Hand-made themes load from their own files (themes-custom.json and themes-custom.css), separate from the themes taken from the website.

## [5.41.6] - 2026-11-20

### Fixed
- Admin Requests: clicking a box in the request flow filters the list below it, and there is a Category filter next to Status.

## [5.41.5] - 2026-11-20

### Fixed
- Number settings such as Downloads at the same time can be typed into. A typed number used to snap back to the old value unless the little arrows were used.

## [5.41.4] - 2026-11-20

### Fixed
- In narrow windows the tabs are smaller, so the whole tab bar fits on one or two rows and the header takes up less of the window.

## [5.41.3] - 2026-11-20

### Fixed
- Updating no longer cancels downloads. Paused downloads no longer block or trigger the update question, and Update Now pauses running downloads, which come back as Paused after the update.

## [5.41.2] - 2026-11-20

### Fixed
- In a narrow window the tab bar wraps onto a second row, so tabs like Music and Tools are no longer cut off.

## [5.41.1] - 2026-11-20

### Added
- Downloads of several picked items (a whole collection, several albums) also come back as Paused after a restart, and Resume carries on with the same items.

## [5.41.0] - 2026-11-20

### Added
- Downloads that were paused or interrupted (an update, a restart, a crash) come back in the Downloads tab as Paused. Resume asks the site for a fresh link and carries on; files already downloaded are kept. Downloads made by picking several items are not kept.

## [5.40.3] - 2026-11-20

### Fixed
- "Open folder" on a Music or Comics download opens the folder with that album or series in it, and on a game extracted to another drive it opens the extracted game, not the main download folder.

## [5.40.2] - 2026-11-20

### Fixed
- The MiB/s option now also changes the speed shown next to each file being downloaded, not only the total at the top.

## [5.40.1] - 2026-11-20

### Fixed
- Empty files in a download are created on the PC directly instead of being requested from a server.
- Removed the file-list note about small files using the gateway: they now come from Google Drive like everything else.

## [5.40.0] - 2026-11-20

### Added
- Extract folder setting (Settings, Folders): automatic extraction can unpack games into a folder of the same name on another drive. Empty keeps extracting next to the download.
- The file list in Downloads explains that small files (under 1 MB) come through the gateway.

## [5.39.1] - 2026-11-20

### Added
- Each file in the list of files being downloaded is tagged Drive (straight from Google Drive) or Gateway.
- The Comics panel shows the size of the library next to the number of comics, like Music does.

## [5.39.0] - 2026-11-20

### Added
- Every running or paused download has a Show MiB/s button next to its speed (bits per second stay the default; the choice is remembered).
- Each running download lists the files being downloaded right now, each with its own percent, speed and bar.

### Fixed
- Updating while a download was paused asked whether to quit anyway, and cancelling left the old window open next to the installer. Paused downloads no longer block an update, a running download makes the update say so first, and quitting for an update no longer asks again.

## [5.38.1] - 2026-11-20

### Fixed
- Downloads of collections with many small files showed 0 bps and an impossible time left. Speed and time left now come from the overall progress over the last minute.
- Download All on very large collections (the DC Collection has 106 series) said Nothing to download: the limit of 50 folders is now 500.
- Music and Comics downloads from the new window ignored the folders chosen in Settings; they now go to the Comics and Music folders (with none chosen they still go to the download folder).

## [5.38.0] - 2026-11-20

### Added
- Files inside a game folder show the part of their name that tells the pieces apart (.part2.rar, .7z.001, .zip), so a single piece can be picked.

## [5.37.1] - 2026-11-20

### Fixed
- After a graphics hiccup the app could stay slow for good (one GPU crash switched hardware drawing off permanently). The setting now lasts 24 hours, then the next start tries the graphics card again.

## [5.37.0] - 2026-11-20

### Added
- A Forward button (Alt+Right, or the mouse forward button) next to Back.

### Changed
- Back returns to the same spot: the folder, the search, filter and sort, and how far the list was scrolled.
- Clicking the name of a folder card opens its page, like the Browse button.
- The window is titled ARMGDDN Browser.

## [5.36.3] - 2026-11-20

### Fixed
- The app could appear frozen when a new-version prompt opened behind the window: the prompt came from the hidden classic window as a blocking box. Prompts now belong to the window in use, never block the app, and the hidden window no longer pops its own update prompt.

## [5.36.2] - 2026-11-20

### Changed
- The website's Open ARMGDDN Browser button (armgddn://open) brings the app forward.
- The app tells the website when it is set to the classic window, so the website only becomes informational for people using the new window.

## [5.36.1] - 2026-11-20

### Changed
- 3D Printer Models shows a short note that many models do not have a cover picture yet and that missing covers there are expected.

## [5.36.0] - 2026-11-20

### Added
- Admin has a Console tab for owners with the website's owner commands (admins, admin+/-, req+/-, both+/-, ban, unban, bans, lookup, reload, help). Bans and admin changes ask for confirmation first.
- Every bar in the Admin charts shows its number.
- In the reports, members show as @name (or their Telegram ID when they have none), and clicking a name copies it.

### Changed
- Game titles in the reports read as full names, and the same game under two spellings is counted once.

### Fixed
- The PC or PCVR badge on Home cards was hidden behind long titles.

## [5.35.1] - 2026-11-20

### Fixed
- The window no longer stays locked up after running for a long time: a window that stops responding reloads itself after 20 seconds, and debug.log records the freeze with memory and processor figures so the cause can be found.

## [5.35.0] - 2026-11-20

### Added
- Home cards, including Hidden Gems, show a PC or PCVR badge.

### Changed
- Desktop and Start Menu shortcuts (Windows) are named ARMGDDN Browser while the native window is on, and ARMGDDN Companion when it is off. The native window is titled ARMGDDN Browser.

## [5.34.0] - 2026-11-19

### Security
- Deep links no longer replace the saved sign-in, and Komga deep links ask for confirmation.
- Direct cover fetches refuse private addresses and are limited in time, type and size.
- Electron run-as-Node, Node options and debug-port features are disabled at pack time.
- The saved sign-in file is readable by the user only.
- The page policy gains object-src, base-uri and form-action.
- Sensitive admin actions are confirmed by the app in a system dialog.

## [5.33.0] - 2026-11-19

### Changed
- Admin charts say what each bar is, show the values and the peak, and have hover notes. The last row of chart cards is centered.

### Fixed
- The Desert Dusk header curve clipped the Logout button.

## [5.32.0] - 2026-11-19

### Added
- Save any Admin page as a PDF.
- A back-to-top button on long pages.
- Missing art: Auto-fix covers, and a YouTube trailer search for each game.

### Fixed
- Admin sizes show as GB and TB, and decades and years have no thousands comma.
- The Reliability chart's date labels and the testing weeks table now show real dates.
- The Top 25 lists have card backgrounds.

## [5.31.0] - 2026-11-19

### Added
- Admin Overview: the website's live routing map and service map. Requests: the request flow map.
- Usage cards (total requests, downloads, download cache) and owner buttons to reset the usage numbers and the download cache.

### Fixed
- The Admin tab row collapsed after the 5.30.1 layout change.
- Admin tables showed some times as raw numbers.

## [5.30.1] - 2026-11-19

### Fixed
- The owner status dock is now the last row of the window instead of an overlay, so it no longer covers the bottom of the page, the What's New Got it button or messages (the toast now sits above it).
- Settings, Tools and Admin scroll inside their own box, so the dock stays at the bottom of the window.
- The Admin view no longer draws the library list underneath it.
- The publisher collections on the Comics page scroll with the list instead of staying fixed above it.

## [5.30.0] - 2026-11-19

### Added
- **Status dock** for owners along the bottom of every page (the website's System widget): Status, Overhead, Loop,
  Streams, Users, Speed and Queue, refreshed every 5 seconds, with 30 minute graphs that survive a restart.
  The title, Overhead and Loop open Analytics; Status opens the site status window; Streams, Users, Speed and Queue
  open their detail pages.
- **Owner view** setting: turn it off to hide the Admin tab and the dock and see the app as a regular member.
- **Admin:** re-fetch all game art (with a progress line), add or remove admins, ban a member by Telegram id,
  look up a member, reload the art overrides, and set a cover or a YouTube trailer from Missing art.
  Each action asks for confirmation first.

## [5.29.0] - 2026-11-19

### Added
- **Admin tab** in the built-in window, for owners and admins only (the site decides who qualifies):
  Overview, Analytics, Music and Comics, Reliability, System, Activity, Missing art, IP bans, Access,
  Controls, Queue, Requests and Audit. The reports are drawn in the app without a chart library.
- **Actions** with a confirmation step each: change a request's status, stop listing a game in Missing art,
  ban or unban an IP address, reset mirror quota, restart the server.

### Notes
- The owner console, editing the admin lists, adding art or trailers by hand and the art auto-fix stay on the website for now.

## [5.28.0] - 2026-11-19

### Added
- **Watchlist** in the built-in window: "Tell me when it is added" under a search, and My watchlist. Same list as the website.
- **Newest / Older** tags when the same game is in more than one place with different builds.
- **Closest-title search** when nothing matches exactly, and a line saying when a title is also in another section.
- **Comics** show their proper title, issue number, release date and a ComicVine tag, listed in release order.
- **Publisher collections** (Marvel, DC) with Download All at the top of Comics, under the Komga box.
- **Quota:** a section whose download quota is used up is dimmed. Folders that only point to the other server say "You must download from PCVR server" (or PC) with a Go there button.
- **Help > About** with the version and a Copy details button.

### Changed
- The Wiki in the built-in window is rewritten for the app (Komga and Linux sections carried over).

## [5.27.0] - 2026-11-19

### Changed
- **Settings** in the built-in window are now grouped into one card per topic: Updates, Folders, Downloads, Your games, The app and its window, Import, and Help and reports.

## [5.26.3] - 2026-11-19

### Fixed
- **Updating from Settings:** when a check finds a new version, the "Check for updates" button becomes "Update to vX" and installs it.
- The "Update now" bar was drawn at the very bottom of the page, out of sight. It is now at the top, under the header.
- The Settings page background is one smooth backdrop from top to bottom instead of tiled stripes.

## [5.26.2] - 2026-11-18

### Added
- **File menu:** Settings, Check for updates and a switch between the new and the classic window, in either window. **Help:** Open the log folder.

### Fixed
- **The Requests page froze the built-in window.** A notice that belongs to the library pages had been placed inside it and threw an error. A page that fails to draw now shows a message with Try again and Back instead of freezing the app.
- **File > Exit** now really exits instead of hiding the app in the tray.
- The Music and Comics "some items may be missing" notice now shows in those libraries.

## [5.26.1] - 2026-11-18

### Added
- **A Back button on every screen** of the built-in window, plus Alt+Left and the mouse back button.
- **Game updates link to the library.** Each game with a newer version in "Check my games" opens it in the library when clicked.

## [5.26.0] - 2026-11-18

### Added
- **A fixed top bar and a page bar in the built-in window.** The top bar is the same on every page with the current page lit in the theme's colour; the bar below holds that page's own controls.
- **Grid / List switch** for every list of titles: the cards with art, or one plain line per title.

### Fixed
- The A to Z jump bar sits inside the list area and works in list view.
- Empty lists say so instead of showing the loading spinner.

## [5.25.1] - 2026-11-18

### Fixed
- **3D model and PC app pictures** were not loaded by the built-in window. They now are.

## [5.25.0] - 2026-11-18

### Added
- **Hourly update check in the background**, with a notification when a new version is ready.
- **Check for updates button** in the built-in window's Settings, and an Update now bar.
- **Download schedule, game update check, .7z help video, What's New and Clear history** in the built-in window.

### Changed
- The update window and update notices say ARMGDDN Browser for members on the built-in window.

## [5.24.2] - 2026-11-18

### Fixed
- **Native window from the tray and a second launch.** In native mode, opening the Companion again or clicking the tray icon showed the hidden classic window. It now shows the native window, and closing the native window keeps the app in the tray when that setting is on.

## [5.24.1] - 2026-11-18

### Fixed
- **Cover art in the built-in window** is shown whole over a blurred backdrop unless its shape matches the tile, as on the website.
- **Update housekeeping files** (such as `updatePCVR-FTP.txt`) are no longer listed.

## [5.24.0] - 2026-11-18

### Added
- **A Komga section on the built-in window's Comics tab**, matching the website: Download Komga, Setup guide and Add reading orders.

### Changed
- The app can now open komga.org links from the built-in window.

## [5.23.1] - 2026-11-18

### Changed
- **The introduction animation plays only after a first sign-in in the built-in window.** Members who open it already signed in, or who have seen it on the website, no longer get it.
- **Settings in the built-in window** now include Minimize to the tray and Start minimized.

### Fixed
- **The built-in window's introduction animation** never started (the screen could stay on a glowing orb). It now plays, and a failed intro removes itself instead of covering the app.
- **A Companion that is not the installed app** (a development or test copy) can no longer install updates over the real one.

## [5.23.0] - 2026-11-18

### Added
- **A new built-in browser window, for members the site lists.** While it is being tested the Companion opens it only for those members (the site decides). They can switch back to the classic window in Settings or from the tray menu, and `--classic` / `--native` on the command line always win. Everyone else sees no change.
- **Per-file download sources.** A download can now carry its own sign-in header, renewal and fallback source. Nothing uses this yet.

### Changed
- **Add to My Komga matches your own files exactly.** A reading order is now built from the site's catalog: each comic is found by its exact file (same file name and size, with the folder as a tie-break), then by its Comic Vine issue, never by series name. The list comes out in reading order with the right editions even when your Komga has several series with the same name. A reading order the catalog does not know falls back to the reading-order file as before.

### Fixed
- **Add to My Komga with current Komga versions.** Komga now answers the match call with candidates for each issue instead of a ready request, which made every add report "none of the issues matched". Both answers are understood. A list that already exists is now found and replaced even when Komga's name search misses it.
- **A byte-order mark in the settings file** no longer stops the Companion from starting.
- **Copies of the app run from a test folder** can no longer take over `armgddn://` links from the installed Companion.

## [5.22.3] - 2026-11-18

### Changed
- **Links renewed before they expire.** A download link is now renewed about 90 seconds before it runs out, instead of after the server refuses it, so long downloads no longer hit a burst of failed requests.
- **More specific retry causes.** HTTP/2 and network error families get their own labels; unrecognised wording gets a short fingerprint. No text, hosts or paths are sent.

## [5.22.2] - 2026-11-17

### Added
- **Retry causes in download reports.** Each retry now carries a short label (for example econnreset, dropped, timed out, http 503). Hosts, addresses and paths are never included.

## [5.22.1] - 2026-11-17

### Added
- **Download diagnostics.** When a download attempt is paused, cancelled, fails, or needs retries, the Companion reports to the site why it ended: outcome, retry reasons and counts, streams, duration, average speed, and whether the direct endpoint was used. No file names or paths are sent.

## [5.22.0] - 2026-11-17

### Changed
- **Comics downloads keep their collection and series folders.** A download that spanned several collections was named after its first comic (Marvel came out as "Fantastic Four Collection", DC as "Batman Collection") and every file was saved flat in that one folder, so Komga treated everything as one series. The site now names each file by its path below the shared parent of the chosen items, and the Companion keeps those folders. A batch spanning several collections is named "Comics"; one within a single collection is named after that collection.
- **"Only what I'm missing" keeps the library layout.** New comics are saved under their collection folder inside your comics folder (the site sends the shared base folder and the Companion puts it back in front of each file).

## [5.21.3] - 2026-11-16

### Fixed
- **Linux: a desktop notification could abort the whole app.** Electron's Notification calls libnotify inside the app, and on some desktops (Nobara/Fedora 44 with KDE Plasma) libnotify aborts the process with SIGABRT when a notification is shown (Sentry ARMGDDN-COMPANION-60 and -61). Linux notifications now go through `notify-send` in a child process, with the AppImage library paths removed; if it is missing nothing is shown. Windows and Mac are unchanged.

## [5.21.2] - 2026-11-16

### Changed
- **Frozen shared HTTP/2 connections are found in about 20 seconds, not 60.** A connection with no bytes for 15 s while requests are open gets an HTTP/2 PING; no answer within 5 s replaces the connection. A server that only holds requests (a queue) answers the PING and is left alone. The HTTP/1.1 fallback keeps the 60-second recovery.

## [5.21.1] - 2026-11-16

### Fixed
- **History: Check for game updates did nothing.** The button reused the id of the app-update button, so the click handler was attached to the other one. Renamed, and a test now fails on any duplicate id in the page.
- **Install progress window:** the bar is a Marquee bar, which Windows draws frozen unless visual styles are enabled. They are now enabled before the window is created, and the animation speed is set.

## [5.21.0] - 2026-11-16

### Added
- **Adaptive connections.** With Connections per file on Auto, each time a whole shared connection is found frozen (the 5.19.1 detector) the next files start with fewer connections: 8 after one freeze in the last hour, 4 after two, 2 after three or more. An hour after the last freeze it returns to the full number. Logged as `[adaptive]`.
- **Quiet hours (Settings).** A weekly window (days, start, end, past midnight allowed) that pauses downloads or limits their speed. A 15-second ticker applies it, shows a banner, resumes what it paused, and restarts running downloads when a limit window begins or ends. Downloads the member paused are left alone.
- **Check for game updates (Download History).** Sends the folder names of finished downloads to the new site route `/api/library-updates`, which answers the games with a newer version in the library (Steam build number, or dotted version; never compared across kinds).

## [5.20.0] - 2026-11-16

### Added
- **Test my connection (Settings).** Reads ranges of a recently downloaded archive for 12 seconds each at 16, 8, 4 and 1 connections, discards the data, and recommends a Connections per file value (with a Wi-Fi/router hint when the higher settings paused and a one-click apply). Uses the new site route `/api/connection-test`, which needs the app sign-in.
- **Setup summary in logs sent to staff:** connections per file, downloads at once, speed limit, own-downloader and direct-endpoint state, whether a proxy variable is set (never its value), versions, and the last connection-test result.

## [5.19.1] - 2026-11-16

### Changed
- **Stalled shared HTTP/2 connections are thrown away.** When a stream times out and no bytes have arrived on the whole connection for about the stall time, the connection is destroyed so the retry dials a fresh one instead of queueing behind the dead one. One slow stream on a healthy connection only loses that stream.
- **Idle HTTP/2 sessions are destroyed 5 seconds after `close()` if the peer does not answer.** Keeps TLS sockets with queued writes out of garbage collection, the path where Sentry ARMGDDN-COMPANION-5Z crashed.

## [5.19.0] - 2026-11-15

### Added
- **Connections per file setting (Auto, 8, 4, 2, 1).** Caps how many parallel connections each large download opens. It only lowers the automatic choice (16, 8 under heavy load, 2 on the proxy route). Default Auto, so nothing changes unless chosen. Helps routers and Wi-Fi that stall when a file opens many connections.

## [5.18.1] - 2026-11-15

### Changed
- **Updated the app's built-in engine (Electron 44.11.3 to 45.3.2).** This brings the newer Chromium and Node versions with their security fixes. It is aimed at rare native crashes in the engine's memory management (garbage collection) that Sentry showed on Linux (ARMGDDN-COMPANION-5X, 5Y and 5W). No settings or behavior change.

## [5.18.0] - 2026-11-14

### Added
- **The built-in downloader now works through an HTTP proxy.** Large files use the Companion's own downloader, which ignored the PC's proxy settings (only rclone honoured them). It now reads `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` and `NO_PROXY`, tunnels through the proxy (CONNECT, with a username and password if the proxy address includes them) and still uses one HTTP/2 connection when the server offers it. SOCKS proxies are not supported. The direct-download port and the app's own site calls are unchanged.

## [5.17.1] - 2026-11-13

### Fixed
- **Downloads failed repeatedly when the PC's proxy settings pointed at a proxy that was not running.** A VPN or proxy program can set a proxy address (such as 127.0.0.1:18092) in the PC's environment; when the program was closed, every attempt and every automatic retry failed with "proxyconnect ... connection refused". The failure now says the PC is set to use a proxy that is not running and what to do, and the automatic retry (and later downloads) run the downloader without those proxy settings.

## [5.17.0] - 2026-11-12

### Added
- **A second, dedicated download address.** The hosting provider caps the managed download link at about 100 simultaneous connections for everyone together, and resets new ones past that, which showed up as brief outages and "connection forcibly closed" errors. The same download server is now also reachable on its own port with its own certificate. The app trusts exactly that certificate (and the normal system certificates), so it still refuses any other server. The site switches this on; when it is off, unreachable, or after a failure, the app uses the usual link as before, and a failure pauses the new address for ten minutes.

## [5.16.6] - 2026-11-11

### Fixed
- **A download gave up after its first automatic resume.** When a failure looked like a dropped connection, the app waited for the network and resumed once, then showed the error if the connection dropped again. It now resumes up to 5 times per download, with a longer pause before each new attempt, and every attempt continues from the part already on disk. Errors a retry cannot fix (full disk, quota, wrong date and time, download folder, security error) are still not retried.

## [5.16.5] - 2026-11-11

### Fixed
- **The app would not open on a PC with no Downloads folder.** Electron failed with "Failed to get 'downloads' path" when Windows had no Downloads folder for the account, for example if it was removed or redirected to a drive that is not there, and that stopped startup. The default download location now falls back to Documents, then the home folder (Sentry COMPANION-57).

## [5.16.4] - 2026-11-06

### Fixed
- **"Send log to staff" did nothing for members whose sign-in had expired.** The site refused the upload without a valid sign-in, and the app's message for that was vague. The site now accepts a cleaned log with or without a sign-in (limited to 5 a day per member or address), and the app sends it either way. If the site still refuses, the message now includes the error number, and `debug.log` records each attempt (`[support-log]` lines).

## [5.16.3] - 2026-11-05

### Fixed
- **Music and Comics "Only what I'm missing" said "Your sign-in expired" after a restart.** The token the site's button hands over was kept in memory only, so a restart lost it and the app fell back to an old saved sign-in. The token is now also saved as the app's sign-in, and a catalog request tries every sign-in the app holds (the button's token for this page, the other page's, the saved one) before reporting that it expired.
- The log now records whether the site's token arrived and which sign-in a refused catalog request used.

### Changed
- The site now keeps an app sign-in for 30 days of idleness instead of 24 hours (every use renews it, and group membership is still checked hourly), so an app that sat unused for a few days no longer needs the site's button again.

## [5.16.2] - 2026-11-05

_5.16.1 was tagged but its build failed the packaged-app test (the new `updateRunner.js` was missing from the package list), so it was never published. Nothing else changed._

### Fixed
- **Updating could fail the first time or two.** The silent installer takes 20 to 80 seconds with the app closed and nothing on screen, so members opened the app again. That copy started a second installer on top of the first (exit code 2) and relaunched the old version, and the startup check mistook the running install for a failed one. The app now writes an "installing" marker before it closes; a copy that starts while an install is running says so and closes itself, and no second install is started. The marker is ignored after 5 minutes.
- **The update download bar stayed empty.** GitHub's download servers sometimes send no `Content-Length`, so the percentage stayed at 0 while only the speed moved. The size from the release listing is used instead, and with neither the window shows megabytes downloaded.

### Changed
- While the update installs, a small always-on-top "Installing the update" window with a moving bar stays on screen until the installer finishes, then the app reopens by itself.

## [5.16.0] - 2026-11-05

### Added
- **Settings > Setup Check > Send log to staff.** Sends the recent `debug.log` (up to about 900 KB) with user names in paths, URL query strings, e-mail addresses, IP addresses and anything that looks like a token or password removed, and gives the member a short code (`LOG-ABCD-2345`) to paste in the support chat. The site keeps the log for 7 days and a member can send five a day. Tulip reads the log from the code.

## [5.15.2] - 2026-11-05

### Fixed
- A failed download no longer reads "the link looks invalid or expired" when the output merely contained the words "not found" somewhere. A real 404 is still recognised, from the error line or the CopyURL wording.
- A connection closed by the other side, including Windows socket errors in any language (`wsarecv`, `wsasend`), now shows "The connection dropped mid-download" and is no longer reported to Sentry as a new issue for every PC.
- A crash of the download engine's Go runtime (`fatal error: runtime: ...`, `mcall called on m->g0 stack`) is reported as an engine crash, not an expired link.
- "server gave HTTP response to HTTPS client" gets its own message about a VPN, proxy or security program.
- The 401, 403 and 429 checks matched digits inside port numbers; they now match whole numbers only.

### Changed
- Electron 44.10.2, @sentry/electron 7.20.2, electron-builder 26.18.0.

## [5.15.1] - 2026-11-04

### Fixed
- Linux: when Chromium closes the app at startup because its graphics process cannot start (the "GPU process isn't usable" crash on some NVIDIA drivers), the existing software-rendering fallback never got a chance to be recorded, so the crash repeated on every launch. The app now also notes whether each launch ended cleanly, and after two launches in a row that did not, the next one runs in software rendering.

## [5.15.0] - 2026-11-04

### Changed
- "Check files after download" is on by default. It is switched on once for everyone (the old default was off); after that the member's own choice is kept, including off.

### Fixed
- A dropped connection could start the retry while the last disk write was still running (a slow disk or antivirus scanning), and the retry could write over part of the file: the right size, but failing to extract. Every write now waits for the one before it. A stress test that cuts connections and restarts downloads at random moments now covers this.
- A damaged file inside a protected archive was reported as "wrong password or encrypted archive". It now names the file that failed its CRC check and points to Check files.

## [5.14.0] - 2026-11-04

### Added
- Only what I'm missing for one folder. Every artist, album, collection and series folder on the site's Music and Comics pages has its own button, which opens the Companion and compares just that folder with yours. In Comics the folder appears as a choice in the "Compare with" list; the Music panel shows it and has a "Whole library instead" button.

## [5.13.0] - 2026-11-04

### Added
- Music: only what I'm missing. A new Music button opens a panel where you pick the folder your music is in. The Companion lists it on your PC, compares it with the library and shows how many albums are complete, partly there or missing. Nothing about your folder is sent to the site. Tracks match by artist folder, album folder and title, so another format or different track numbers still count as owned; an empty or cut-short file is flagged and downloaded again.
- Download what I'm missing saves just those tracks into your music folder with the library's folder layout. Nothing in that folder is unpacked, and cancelling removes only the files that download wrote.
- The Music page on the site has an Only what I'm missing button that opens the panel.

## [5.12.1] - 2026-11-03

### Fixed
- The comics scan no longer starts blind. If the site's library list cannot be loaded (for example because the sign-in has expired) it says so and tells you what to do, instead of silently opening every file, which takes hours on a cloud or network drive. The list is needed anyway to compare your folder with the library.
- When a scan finishes it shows how many comics were matched by name and size without being opened.

## [5.12.0] - 2026-11-03

### Changed
- Scanning a comics folder is much faster when it holds comics from the library, including on a cloud or network drive. A file whose name and size match exactly one library comic is counted without being opened; anything else is read as before, and cut-short files are still flagged.

### Added
- Check my setup now times how long it takes to open a few comics in your comics folder and warns when it is slow, or when the folder is on a network share or a cloud-synced folder. The result is part of the copied report for Tulip (never the folder's path).

## [5.11.0] - 2026-11-03

### Changed
- Download what I'm missing now saves the comics straight into your comics folder, with the library's folder layout, instead of the download folder. Nothing in that folder is unpacked, and cancelling removes only the files that download wrote.
- If no comics folder is chosen yet, the Companion asks you to choose one in the Comics panel before downloading.

## [5.10.0] - 2026-11-03

### Added
- Comics: only what I'm missing. A new Comics button opens a panel where you pick the folder your comics are in. The Companion reads it on your PC, compares it with the library (the whole library or one reading order) and shows how many comics you have and how many are missing. Nothing about your folder is sent to the site.
- Comics are matched by the Comic Vine id inside each file, then by series, issue number and year. A cut-short or empty file is flagged as damaged and never counted as owned, so it is downloaded again.
- Download what I'm missing starts downloads for just those comics, in batches, through the normal download list. They arrive in the download folder with the library's own folder layout.
- The site's new "Only what I'm missing" button on each reading order opens this panel with that list selected.

## [5.9.0] - 2026-11-03

### Added
- The progress bar now shows file checking and extracting as they happen, with a percentage, in the Companion and in the site's downloads panel. Checking is measured by the data read, not the file count, so a big game's bar moves steadily. With several archives, the extraction percentage covers all of them.
- The site forgets a check you stop, and stops showing one that stopped reporting.

## [5.8.0] - 2026-11-03

### Added
- Check my setup now works on Linux and Mac: it checks the format of your download drive (FAT, read-only, NTFS on a Mac), warns about folders that cause trouble (/tmp, system folders, iCloud, Desktop and Documents on a Mac), and on Linux flags a low `vm.max_map_count` and a missing Wine. On a Mac it also checks that the Companion is in Applications, that Rosetta is installed on Apple Silicon, and whether a Windows layer (CrossOver, Whisky, Sikarugir, Wine) is present.
- Copy report for Tulip carries these results (the drive format, never a path), so she can help Linux and Mac members without Windows advice.

## [5.7.0] - 2026-11-03

### Added
- Check files: compares each downloaded file with the checksum (MD5) the drive lists for it. There is a Check files button on finished downloads and in History, and a "Check files after download" setting that checks before anything is extracted and reports which file failed. The site's downloads panel shows the result and links to the check.
- When Auto extract is on without "Check files after download", Check files is hidden (files would be unpacked before anything checked them) and the Companion says so once, with an "I understand" button. The site's downloads panel shows the same.

### Removed
- The Android app (APK) is retired. Companion is Windows, Linux and macOS only; releases no longer include an APK and the `mobile-android` build and the mobile emulator test are gone from CI. The `mobile/` source is kept for reference.

## [5.6.0] - 2026-10-30

### Changed
- The Beta label is removed from the window title and the app header.
- Copy for Tulip now tells you to paste your report code in the ARMGDDN Games Welcome & Support chat.
- The Pause confirmation and the note under each download now describe what Pause does: finished files are kept, large files pick up where they stopped, and a small file in progress may start over.
- "No existing files found. Starting download..." no longer stays on screen for the whole download; it clears once data is flowing and when a download is resumed.

### Fixed
- When a download is retried after an expired link, a dropped connection or a mirror change, it now continues from the last byte it received instead of starting the file again from zero.
- A download no longer shows a confusing "getaddrinfo ENOTFOUND" message under its name when the Companion's start-up server check cannot connect. The check is skipped quietly and the download continues.
- If the download engine itself crashes on a PC (often security software or a driver problem), the Companion now says so and suggests what to try, instead of wrongly telling you the download link expired or retrying as if the network was down.
- Updating the Companion keeps your existing Start Menu and Desktop shortcuts.

### Added
- Pause and Resume keep their progress on large files. Files that rclone would fetch in parallel streams (128 MB and up) now go through a resumable downloader that keeps the same parallel speed, writes to a temporary file beside the final name with a record of every chunk on disk, and only renames it when complete. Pause, a restart or a retry continue from that record. It uses one shared HTTP/2 connection to hosts that offer it, like rclone, and falls back to rclone when a server cannot do partial downloads. The speed limit still applies, Cancel removes the temporary files, and `segmentedDownloads: false` in the settings switches it off.
- Check my setup warns when the download folder is the root of a drive (for example D:\), because Windows protects it and setup often fails there.

### Security
- Electron 44.9.3, undici 6.29.1 / 7.30.1, fast-uri 3.1.9, and mobile zod 4.6.7 (the updates held in the unpublished 5.5.6).

## [5.5.5] - 2026-10-27

### Fixed
- Cancelling a download now stops in-flight transfers and removes files downloaded by that request, including partial files. Files that were already complete before the request started are preserved.
- The cancel confirmation now explains which files will be removed.

## [5.5.6] - 2026-10-27

### Security
- Updated Electron to 44.9.3, including patched Undici 6.29.1 and 7.30.1 dependencies, and pinned fast-uri to 3.1.9.
- Updated the mobile build's Zod dependency to 4.6.7. Expo CLI's node-forge dependency remains at 1.4.0 because no patched npm release is available yet.

## [5.5.3] - 2026-10-21

### Changed
- The Companion no longer limits Add to My Komga to six fixed lists. It accepts any reading-order id the site serves, and takes the list's name from the site.

## [5.5.2] - 2026-10-21

### Changed
- Add to My Komga now updates an existing read list of the same name (matched by name, ignoring capitals) instead of reporting that it already exists.

## [5.5.1] - 2026-10-21

### Fixed
- Add to My Komga asked the bare domain, whose redirect to `www` dropped the login header, so the site refused the read list. It now asks `www.armgddnbrowser.com` directly and checks the reply is a reading list.

## [5.5.0] - 2026-10-21

### Added
- Add to My Komga: the `armgddn://komga?list=<id>` link makes the Companion get a reading list (Marvel, DC, Batman, Daredevil, Spider-Man or Superman) from the site and add it to the member's own Komga server (match, then create), using a saved Komga address and API key. The key is encrypted with the OS keychain when available.
- A small settings window asks for the Komga address and API key the first time. Wrong key or an unreachable Komga clears the saved details so it asks again.

## [5.4.2] - 2026-10-20

### Fixed
- Windows: the download process being ended by a shutdown, sign-out or closing the app is no longer sent as a failure report.
- macOS: ignore the activate event until the app is ready (fixes a "Cannot create BrowserWindow before app is ready" crash).
- The download card falls back to the average speed over the whole download when no peak speed was recorded (many small files finish before rclone prints a speed).

### Changed
- Build: CI skips Dependabot and docs-only pull requests, and build artifacts expire after a day or after a release.
- Build: the release job no longer gets skipped on tag builds (5.4.1 was tagged but never published because of this).

## [5.4.0] - 2026-10-09

### Added
- Android app: landscape support (`orientation` changed from `portrait` to `default`) with a two-column layout when the window is wider than tall.
- Android app: `FocusButton`, so every button takes focus from a TV remote, controller or keyboard and shows a focus ring.
- Android app: `plugins/withTvAndQuest.js` adds the `LEANBACK_LAUNCHER` category, optional `leanback` and `touchscreen` features, and Meta Quest `com.oculus.supportedDevices`.
- Android app: a real launcher icon with legacy, round, adaptive and themed monochrome versions (the build had none, so Android showed its default robot).
- A `Mobile emulator test` workflow that runs the app on a phone and an Android TV emulator and checks the layout and D-pad focus.

## [5.3.1] - 2026-10-09

### Fixed
- Reading `mainWindow.webContents` on a window that was already destroyed threw "Object has been destroyed" and crashed the app, seen in `finalizeCompletedDownload` on 5.0.26 (Sentry ARMGDDN-COMPANION-1M). All 8 places that checked it now go through `mainWindowAlive()`, which tests `isDestroyed()` first.

## [5.3.0] - 2026-10-09

### Added
- **Settings > Check my setup > Copy report for Tulip.** One code (`ARMGDDN-SETUP:1:` plus base64url of deflated JSON, at most about 3,200 characters) holding the app version, OS, the check findings, free space, antivirus names, redistributable status and up to 20 recent warning or error lines from `debug.log`. Before it leaves the machine, `setupReport.js` removes user names in paths, URL query strings, e-mail addresses, IP addresses and anything that looks like a token or password. Pasted into the ARMGDDN chat, Tulip decodes it and answers from the facts. The CI smoke test asserts the report round-trips and that user names and URL secrets never appear in it.

## [5.2.0] - 2026-10-09

### Added
- **Settings > Check my setup.** A button that looks at the causes behind most install and launch support questions and reports each as OK, a warning with what to fix, or "could not check": free space on the download drive; free space on the Windows temp drive (setup unpacks its temporary files there wherever the game is saved); a download folder that is in a protected place (Program Files, Windows, OneDrive, the user profile's Desktop/Documents/Downloads) or has a very long path; the antivirus products installed (third-party ones are flagged) and whether Windows Defender excludes the download folder; and whether the Visual C++ runtime and DirectX 9 files are installed, pointing to `/redists` when they are not. The logic is in `setupCheck.js` (pure evaluation plus a fact collector that never throws), and the CI smoke test asserts that a full temp drive and a missing runtime are flagged and a healthy machine is not.

## [5.1.0] - 2026-10-08

### Changed
- **The "Low Space" box before a download now says what is actually short.** Members who changed their download folder still saw a C: warning and reasonably thought the change had not worked. When the download folder is on another drive, the box now opens with "Your download folder is fine" and names the drive that needs room: setup unpacks its temporary files into the Windows temp folder (C: by default) wherever the game is saved or installed. When the download folder is on the temp drive too, it says the downloaded files and setup's temporary files both need room there. The box points to a new Wiki entry on moving the temp folder.
- The CI smoke test asserts the box's wording.

## [5.0.26] - 2026-10-06

### Changed
- **The Linux install command saves the AppImage to `~/Applications/ARMGDDN-Companion.AppImage` instead of `~/Downloads`.** The `armgddn://` link handler points at the AppImage's exact path, so a file left in Downloads broke browser downloads as soon as it was tidied away. The name is fixed, so re-running the command updates the same file; it downloads to a `.part` file and renames it into place, so a copy that is running is never overwritten. Debian/Ubuntu still get the `.deb`. (The installer is served by the website and changes only for new installs.)
- On every Linux launch the log now records when the handler path changes and what the system's default `armgddn://` handler actually is (flagging when it is not this app).

### Fixed
- **The `armgddn://` link did nothing when the AppImage lived in a folder with a space in its name** (for example `~/My Apps`). The path in the generated `.desktop` entry is now quoted and escaped per the Desktop Entry spec, checked against GLib's parser for spaces, `$`, apostrophes and backslashes. A literal `%` in a folder name is still not supported.
- **In-app AppImage updates left a `<AppImage>.old` backup behind after every update.** It is now deleted once the new version has run for two minutes (regular files only, and only when the running AppImage looks sane and the backup is not newer).
- The CI smoke test asserts the path quoting and the cleanup rules.

## [5.0.25] - 2026-10-04

### Fixed
- **A member who had left the ARMGDDN group saw "session expired" and a login loop instead of the real reason.** They kept a valid browser session, but every download token minted for them was revoked on first use, so the app only ever got a bare 401. The site now answers `NOT_IN_CHANNEL` (on the download button and on token revocation), and the Companion shows the rejoin steps (rejoin the group, complete Rose's CAPTCHA within an hour, retry) and stops retrying or reopening the login window, which cannot fix it.
- The CI smoke test asserts that `NOT_IN_CHANNEL` surfaces the server's message and that an ordinary 401 does not.

## [5.0.24] - 2026-10-04

### Fixed
- **A failed download could report rclone's startup line as the cause.** A member's failure showed "Starting bandwidth limiter" because rclone exited before logging a real error and the last line of its output, an INFO line, was used as the detail. INFO and DEBUG lines are now ignored when choosing the failure message, so the app falls back to the exit-code message ("Download failed (code N)") and Sentry shows something actionable.
- The CI smoke test asserts that an INFO-only log gives no detail and that a real error line is still reported.

## [5.0.23] - 2026-10-02

### Fixed
- **Auto-extract still failed on a Linux AppImage after 5.0.22.** The member's log showed `[7z] List failed: code=null err=yes`: the bundled 7za looked executable but would not spawn, so 5.0.22's private-copy fallback never triggered. `run7zExtract` now resolves a working tool once, trying the bundled 7za in place, a forced private copy in the data folder, then the system's `7zz`, `7z` or `7za` (Linux and macOS), and keeps the first that answers `7za i`.

### Changed
- If no tool starts, the error says the built-in tool couldn't start (with the reason) and to install 7-Zip or extract by hand, instead of "Failed to validate archive contents".
- `debug.log` records every tool attempt with its exact result, the tool's path, size, permissions and platform, the spawn error and 7-Zip's own output when a check fails, and why an entry path was rejected. The password is never logged.
- The CI smoke test uses the same resolver, with the execute bit stripped and chmod forbidden, and fails unless the private copy (or a system tool) was used.

## [5.0.22] - 2026-10-02

### Fixed
- **Auto-extract still failed on some Linux (and macOS) installs after 5.0.21.** The bundled `7za` can lack the execute bit, and installs under `/opt` (root-owned) or an AppImage mount (read-only) don't let the app chmod it, so spawning it failed and extraction reported "Failed to validate archive contents before extraction". `run7zExtract` now falls back to a copy in the app's writable data folder (chmod 755 there) when the tool can't be run in place.

### Changed
- **The CI smoke test now reproduces a real install.** On Linux and macOS it strips the execute bit and forbids chmod before the extraction round trip, and it fails unless the private-copy fallback was actually used. The 5.0.21 test chmod'ed the file itself, which hid this problem.

## [5.0.21] - 2026-10-02

### Fixed
- **Auto-extract was broken in 5.0.18, 5.0.19 and 5.0.20.** electron-builder 26.15 stopped pulling in `7zip-bin` as a hidden dependency, so the `extraResources` copies from `node_modules/7zip-bin/*` found nothing and the packaged app shipped without `7za`. Every extraction failed at the validation step with "Failed to validate archive contents before extraction". `7zip-bin` is now an explicit dev dependency.

### Added
- **CI smoke test for extraction.** The packaged-app smoke test now creates a password-protected archive with the bundled 7za and extracts it through the app's real `run7zExtract`. Without the dependency it failed on Windows, Linux and macOS, and with it it passes on all three, so this class of packaging loss can't ship silently again.
- A missing extraction tool gets its own message ("The extraction tool (7-Zip) is missing from this install...") and a log line, instead of the generic validation error.

## [5.0.20] - 2026-10-02

### Changed
- **Electron 42.11.10 -> 44.5.1.** Checked against the 43 and 44 breaking-changes lists: Companion uses none of the removed or changed APIs (clipboard in renderers, isUnityRunning, login-item attributes, select-client-certificate, net.request frames) and builds no 32-bit targets. `npm audit` is clean. CI test builds passed on Windows, Linux, macOS and Android.
- **macOS 13 is now the minimum** (an Electron 44 requirement). The update check no longer offers 5.0.20 or newer to Macs older than macOS 13 (it says why in a manual check), and the Mac package declares a 13.0 minimum system version.
- **A missing download drive is named in the error** ("drive D: isn't available right now"), with the advice to reconnect it or pick another folder. Before, mkdir failed with a generic message.

## [5.0.19] - 2026-10-01

### Changed
- **Android app upgraded from Expo SDK 51 to 57** (React Native 0.74 to 0.86, React 18 to 19, react-native-blob-util 0.19 to 0.25). The classic file API now comes from `expo-file-system/legacy`, `SafeAreaView` from `react-native-safe-area-context`, and `expo-system-ui` keeps the dark theme on Android. The mobile `npm audit` went from 38 findings (2 critical) to 0. Tested on a Pixel: the app opens, the layout is correct, and a real download from the site completes.
- CI: `expo prebuild` uses `CI=1`, and `gradle.properties` is ended with a newline before settings are appended (the missing newline broke Expo 57's autolinker). Ubuntu runners are pinned to 24.04 and the GitHub Actions are on current versions.
- Desktop app: no changes.

## [5.0.18] - 2026-10-01

### Security
- **Electron 42.0.1 -> 42.11.10** (11 Chromium security releases) and electron-builder 26.8.1 -> 26.15.3. `npm audit` is clean (was 15 findings in the build tooling). Removed the old `ajv@6` override, which electron-builder 26.15 can't build with.

### Changed
- **Clearer message when the downloader engine can't start** (COMPANION-E, `spawn EFTYPE`): it now says the antivirus may have quarantined or blocked the engine, to restore it from quarantine and add the Companion's install folder as an exclusion, instead of telling people to disable their antivirus.
- **Update check no longer reports a GitHub rate limit as an error** — it says GitHub is limiting checks from the network and to try again later, and logs a warning instead of an error. The CI smoke test no longer calls GitHub at all (it failed the 5.0.17 macOS build once).
- A download folder that can't be created (missing drive, no permission) is explained in the app and is no longer reported to Sentry (COMPANION-1B).

## [5.0.17] - 2026-10-01

### Changed
- **Error reporting no longer includes expected download failures** — rate limits, expired/invalid links, stalls, network/DNS drops and gateway 500s are handled by the app and the user is told what to do, so they are no longer sent to Sentry. Remaining rclone errors are grouped regardless of the timestamp in the message, so one failure no longer creates a new issue every time. 404s are still reported on purpose, since they exposed a real gateway misconfiguration.

## [5.0.16] - 2026-09-28

### Added
- **Auto-retry after network drops** — a download that fails on a transient error (stall, expired link, network/DNS, timeout, gateway) waits for the network (up to 30 min) and resumes once on its own, like clicking Retry (Sentry COMPANION-2/-3/-5/-6). Disk-space, quota, clock and folder errors are left to the user.
- **Pre-download install-space warning** (Windows) — before starting, checks free space on the drive holding the Windows temp folder, where setup unpacks its temp files; counts the download too when it's the same drive. Offers Download Anyway / Cancel.

### Changed
- The install-space heads-up at download completion checks the drive holding the Windows temp folder instead of always C:.
- "certificate has expired / not yet valid" errors now say the PC clock is wrong or antivirus is intercepting HTTPS (our certificate is valid), instead of retrying until a generic stall/SSL error (COMPANION-3, COMPANION-C).

### Fixed
- **Cancelled/paused downloads reported as failures** — recovery code mid-retry hit "Download not found" after the user cancelled, then showed "Download failed", notified, and reported to Sentry (COMPANION-3). Abandoned downloads now stop quietly.
- **Crash when launching a second instance while the app was closing** ("Object has been destroyed" in the second-instance handler, COMPANION-B).

## [5.0.15] - 2026-09-28

### Fixed
- **Installs "finishing" instantly with nothing installed after auto-extract** — archives were extracted into an extra `<archive name>` subfolder ("extract to X"), which with our long folder names could push paths past Windows' 260-character limit; setup then skipped every file and verify reported them all missing (reported for Half-Life Alyx). Auto-extract now extracts in place ("extract here").

### Added
- When a download finishes on Windows and the system drive has less free space than the download, the app shows a heads-up that setup unpacks to C: first even when installing elsewhere.

## [5.0.14] - 2026-09-27

### Fixed
- **Downloads failing the instant the user's connection drops** — every recovery path (stall failover, stall retry, link renewal) failed in the same second on `getaddrinfo ENOTFOUND` (Sentry COMPANION-3/-6). Network-down errors now wait up to 5 minutes for the network before retrying, and a file that fails on a DNS/network error retries with a fresh link (up to 3 times per file).
- **"Download link expired" on later parts of multi-part games** — link renewals were capped at 2 for the whole download, so big split archives ran out partway (COMPANION-2, Half-Life Alyx part .011). Renewals are now budgeted per file (3 each, 30 per download).

## [5.0.13] - 2026-09-26

### Fixed
- **No mirror failover on dropped connections** — rclone reports a connection cut mid-file as a bare `EOF` (Sentry COMPANION-A), which `isNetworkStreamError` didn't match, so the download failed without trying another mirror.

### Added
- Download failure reports include `triedMirrors` and a short log of why each stall failover/retry ended (COMPANION-3 failed with `mirrorSwitches: 0` and no trace of why).

## [5.0.12] - 2026-09-26

### Fixed
- **Misleading "Server load is high... (6 / 8)"** — the server's per-user limit is 6 (`APP_BASE_CONCURRENCY_DEFAULT`), but the Max Concurrent Downloads dropdown offered 7–8, so those users saw a permanent throttling warning on a quiet server. The dropdown and saved settings now cap at 6; when the setting exceeds the server's normal limit, the notice names the per-user limit instead of blaming load (load is only blamed when `effective < base`).

## [5.0.11] - 2026-09-26

### Fixed
- **Quota / 429 rate-limit errors now trigger mirror failover** — they're per mirror account, but the failover condition excluded quota and never matched 429, so these failed outright (Sentry COMPANION-8).
- **"Download link expired" on a refusing mirror** — the expired-link refresh retried the same mirror twice; a mirror answering 403 because of Google's per-file limit then surfaced as "link expired" (Sentry COMPANION-2). The second refresh now requests a different mirror and puts the old one on cooldown.

## [5.0.10] - 2026-09-26

### Fixed
- **Settings and other panels cut off on ultra-wide/short windows** — the vertically centred `.settings-content` had no height cap, so a panel taller than the viewport lost its top and bottom. Now capped at `100vh - 2rem` and scrolls internally.

### Added
- **`gpu_fallback` Sentry tag** (`off` / `armed` / `on`) on every event, so a GPU crash on a PC already in software mode (the 5.0.8 fallback not being enough) can be told apart from a first crash.

## [5.0.9] - 2026-09-25

### Fixed
- **Crash when quitting mid-download** ("TypeError: Object has been destroyed" in parseRcloneProgress) — rclone progress kept arriving after the main window was destroyed. All 22 main-window sends now go through `sendToMain()`, which skips a destroyed window/webContents.

## [5.0.8] - 2026-09-25

### Fixed
- **Crash on PCs with a failing GPU process** — Chromium terminates the app ("GPU process isn't usable. Goodbye.", EXCEPTION_BREAKPOINT in Sentry) when its GPU process keeps dying (bad/old drivers, remote desktop, VMs). An abnormal GPU process exit now writes a `gpu-disabled` marker in userData, and later launches run with hardware acceleration disabled (software rendering).

## [5.0.7] - 2026-09-24

### Added
- **Error reporting (Sentry)** — uncaught main-process errors, native crashes, and failed downloads are reported to the armgddn-companion Sentry project. Failed downloads were previously only visible on the user's screen; they're now reported at warning level, grouped by the error's first line and tagged with the mirror. Every event and breadcrumb is scrubbed before sending (URL query strings with signed links/tokens removed, home folder path replaced with `~`, no IP, `sendDefaultPii` off); an event that fails scrubbing is dropped rather than sent. Tracing is off.
- **"Send error reports" setting** (on by default) — turning it off stops all reports. It's checked right before sending, and an error before settings load reads the saved config directly, so an opted-out user's startup crash isn't sent either.

## [5.0.6] - 2026-09-23

### Fixed
- **Mid-download stalls never detected** — the zero-progress watchdog treated any rclone stats line containing a percentage as progress. Once a file had received any bytes, rclone's one-line stats ("42.906 MiB / 4.291 GiB, 1%, 0 B/s") always contain a percentage, so a connection that died partway through a file was never caught and the download sat at the same byte count indefinitely. Progress is now measured by the transferred-byte counter increasing; a 45s window with no byte growth triggers the existing stall handling (falling back to a non-zero speed token only when a chunk has no byte counter).
- **Stalled files failed instead of retrying when no other mirror was available** — stall recovery only retried on a different mirror; if none was available the file was failed outright. It now retries the same file with a freshly signed link (gateway links expire within about a minute), up to 3 times per file, before surfacing an error.

### Changed
- Stall error message updated from "Download stalled at 0 B/s." to reflect stalls that happen after a file has started.

## [5.0.4] - 2026-08-30

### Fixed
- **Download appearing to "restart" after completing** — A download recovering from an expired signed link (token refresh or mirror failover) could be wrongly finalized as failed by the background poll loop while the retry was still in flight, because `activeProcesses` is legitimately empty for the whole duration of the manifest refetch, not just the brief gap between the old process closing and the new one spawning. The finalize-as-failed check now respects a `recovering` flag set for the full duration of both retry paths. Reported by Kaizo, whose debug log made the race condition traceable.

## [5.0.0] - 2026-07-26

### Changed
- **Full visual revamp of the renderer UI** — the app's markup and interaction patterns were modernized while keeping the exact same neon color theme/palette. Emoji-as-icons throughout the header, panel headers, and history dates replaced with hand-authored inline SVG (Feather-style outline icons, recolor via `currentColor`). ~15 inline `style="..."` attributes in `index.html` extracted into real CSS classes. Self-hosted Inter now covers dense body/help copy; Orbitron (headers) and Share Tech Mono (stats/filenames) are unchanged.
- **Settings form controls restyled** — the `#max-concurrent` select and all 7 settings checkboxes now match the app's glassmorphism/glow language (custom chevron dropdown, toggle switches). Underlying element IDs, `.value`/`.checked` semantics, and the `save-settings` IPC whitelist are unchanged — this is markup/CSS only. Settings grouped into "Download Behavior" and "Notifications & Startup" fieldsets.
- **Download/history status indicators** — `.download-state` badges are now color-coded per status (cyan downloading/extracting, lime completed, red failed/cancelled/error, amber paused) with a small glowing status dot, reusing the same dot+pill language `.connection-status` already had. Extended to `.category-badge` too. Progress bars now shimmer while a download is actively running.
- **Modal panels (Settings/History/7z Help)** now fade and scale open/closed via a `.is-open` class instead of snapping via inline `display:none/block`; the old `.settings-panel[style*="display: block"]` CSS selector hack is removed.
- **Toast notifications** added for "Settings saved" and "History cleared" (previously silent).
- **Empty states** for the downloads list and history list now show the ARMGDDN skull mark instead of plain placeholder text.
- **`update.html` reconciled** with the shared stylesheet — its duplicated gradient-heading and `.progress-bar` rules now reuse `styles.css`'s versions instead of redeclaring them locally.
- **Accessibility** — icon-only close buttons now have `aria-label="Close"`; opening a modal now traps focus inside it and marks the rest of the app `inert`, restoring focus to the trigger button on close.

### Fixed
- **Header gradient-text clip regression** (caught before release) — extracting the gradient-text-clip mechanic into a shared `.gradient-heading` utility class initially broke `.app-header h1`'s title rendering: that selector's higher specificity meant its `background:` shorthand silently reset `background-clip` back to `border-box`, making the gradient render as a solid block instead of clipping to the text. Re-declared the clip properties explicitly on `.app-header h1` as well.

### CI
- **`build-win32` and `mobile-android` jobs moved from a self-hosted Windows runner to GitHub-hosted `windows-latest`** — the self-hosted runner was decommissioned. `mobile-android` also drops the hardcoded self-hosted paths (`GRADLE_USER_HOME=C:\gradle-home`, `ANDROID_HOME=C:\Android`) in favor of the runner image's own preinstalled Android SDK, and adds an explicit JDK 17 setup step.

## [4.3.43] - 2026-07-08

### Fixed
- **"Authentication required" right after starting a download** — The previous fix stopped the unnecessary reauth popup by trying the browser's fresh token first, but the very next steps (fetching the manifest, then starting the download) were still hardcoded to ignore that token and fall back entirely to the Companion's own possibly-stale saved session. Now the fresh token carries through the whole flow, and successfully starting a download updates the saved session to match.

### Changed
- Removed an unrecognized `overwrite` input from the release workflow step (cosmetic — GitHub Actions was already silently ignoring it).

## [4.3.42] - 2026-07-08

### Fixed
- **No more unnecessary reauth popup when starting a download** — Clicking "Download with App" while already logged into the website in your browser would still sometimes open the Companion's reauth popup and demand a fresh Telegram login, even though the browser had already handed the app a valid, freshly-minted token via the deep link. That token was being silently ignored (`resolve-download-token` only ever used the Companion's own separately stored session). It's now tried first as a one-shot attempt — never persisted as the saved session, so a stale or crafted deep link still can't silently swap what account the app is logged in as — and only falls back to the stored session / reauth popup if that fails.

## [4.3.41] - 2026-07-08

### Fixed
- **Re-auth popup no longer plays the site's login animation/audio** — The re-auth window (shown when the Companion's session token expires) loads the full site just to re-confirm Telegram login. Its Electron session is a separate storage silo from any regular browser, so the site's once-per-user login-lightning animation was firing as if it were a first-ever visit. The popup now passes `?companionAuth=1` so the site skips it there.

## [4.3.2] - 2026-05-16

### Fixed
- **KDE Plasma compatibility** — Resolved multiple window-management issues on Linux desktops running KDE Plasma:
  - `progressWin` (update overlay) no longer has `parent: mainWindow` on Linux. The `WM_TRANSIENT_FOR` hint caused KDE's compositor to raise the main window to the front whenever the overlay was shown or received focus. The overlay now uses `alwaysOnTop` + `skipTaskbar` without a parent relationship, which correctly positions it without disturbing the window stack.
  - `authWindow` (login dialog) no longer sets `parent` or `modal: true` on Linux. The `_NET_WM_STATE_MODAL` + transient-for combination caused KDE to pop the main window to the front on every focus change inside the modal. The window still functions as a login step via app-level logic.
  - `focus()` calls replaced with `moveTop()` on Linux in the second-instance handler, deep-link flush, and tray restore. KDE's focus-stealing prevention silently drops `focus()` from background processes; `moveTop()` raises the window reliably without triggering the block.
  - `withDialogFocus` / `withDialogFocusSync` skip the `setAlwaysOnTop(false)` + `moveTop()` dance on Linux. X11/Wayland system dialogs appear above all windows natively, so the manipulation is unnecessary — and calling `moveTop()` on a window that previously had a parent could raise the wrong window on KDE.
  - Tray icon now raises the window with `moveTop()` on Linux (both `click` and `double-click` events). KDE Plasma may route tray activation as either event depending on system settings.

## [4.2.99] - 2026-05-14

### Fixed
- **Auto-update double-runner loop** — Added an `_installUpdateInProgress` mutex to the `install-update` IPC handler. Previously the `%ERRORLEVEL%` clobbering bug (fixed in 4.2.98) could trigger a false app relaunch after a failed install, causing a second auto-update cycle to start immediately. The mutex blocks any duplicate `install-update` call while one is already in flight. The flag is cleared on all failure paths so the user can retry without restarting the app.

## [4.2.98] - 2026-05-13

### Fixed
- **Windows auto-update rc=2 (UAC denial)** — Added `"perMachine": false` to the NSIS config so the installer runs per-user and no longer requests UAC elevation. Silent installs (`/S`) now complete without a UAC prompt.
- **`%ERRORLEVEL%` clobbering in update runner** — The `echo` command immediately after the installer call was resetting `%ERRORLEVEL%` to 0, making every install appear successful regardless of the actual exit code. The runner now captures `set RC=%ERRORLEVEL%` immediately after the installer exits and uses `%RC%` for all subsequent checks. This also prevented the false relaunch that caused the double-runner loop.
- **Node.js version in CI** — Updated GitHub Actions `node-version` from 20 → 22 (required by Electron 42).

## [4.2.97] - 2026-05-12

### Fixed
- **Mac build failure** — `@xmldom/xmldom` override pinned to `~0.8.13` (was `^0.9.0`). The 0.9.x release broke the `plist@3` dependency used by electron-builder for macOS `.pkg` builds: `parseFromString` now requires a mimeType argument that `plist@3` never passes.

## [4.2.96] - 2026-05-12

### Changed
- **Electron 39 → 42** — Upgraded to Electron 42. Requires Node.js 22+ in CI.

### Fixed
- **npm audit vulnerabilities** — Corrected all `overrides` floor versions to clear 8 audit advisories (moderate + high). Added `@electron/get@5` override to drop the deprecated `global-agent`/`boolean` transitive dependency. Pinned `@xmldom/xmldom`, `tar`, `ip-address`, `lodash`, `picomatch`, `minimatch`, `brace-expansion`, `glob`, `rimraf`.

## [4.2.95] - 2026-05-11

### Fixed
- **Downloads stuck at 0% indefinitely** — `resolveDownloadRedirectUrl` made a HEAD request to `/api/download-file` with no timeout. If the server accepted the TCP connection but was slow to respond, the download would hang forever with `downloadedSize=0, hasActive=false`. Added an 8-second timeout with `req.destroy()` and a fallback to the original proxy URL.

## [1.0.24] - 2025-12-06

### Added
- **Git Hook**: Pre-commit hook automatically syncs version numbers across all files
- **Version Management**: Only need to update package.json, rest syncs automatically

## [1.0.23] - 2025-12-06

### Added
- **Deep Link Debugging**: Added visible alerts to track deep link handling
- **Verbose Logging**: Shows protocol, hostname, manifest, and token status

## [1.0.22] - 2025-12-06

### Fixed
- **Download Command**: Use snake_case `download_id` parameter to match Rust backend
- **Parameter Consistency**: Fixed all start_download calls to use correct parameter name

## [1.0.21] - 2025-12-06

### Added
- **Dev Tools**: Enabled via config (right-click → Inspect)
- **Production Debugging**: Dev tools available in production builds

## [1.0.20] - 2025-12-06

### Fixed
- **Panel Display**: Fixed CSS so panels respect inline display:none while staying centered when visible
- **Auto-open Issue**: Panels no longer auto-open on app launch

### Added
- **Dev Tools**: Enabled dev console (F12) for debugging

## [1.0.19] - 2025-12-06

### Fixed
- **Panel Centering**: Added !important to CSS to ensure panels stay centered
- **Debugging**: Added extensive logging for update checker, browse button, and downloads
- **Download Command**: Fixed parameter name from `id` to `downloadId`

## [1.0.18] - 2025-12-06

### Fixed
- **Single Instance**: Prevent multiple app instances from opening
- **Deep Links**: Focus existing window instead of opening new instance
- **Update Checker**: Added HTTP plugin and permissions for fetch API
- **Download Starting**: Deep links now properly trigger downloads

## [1.0.17] - 2025-12-05

### Fixed
- **Protocol Registration**: Register armgddn:// protocol on app startup using Rust
- **Update Checker**: Added better error handling and logging
- **Deep Links**: Protocol now registered every time app runs

## [1.0.16] - 2025-12-05

### Fixed
- **Protocol Registration**: Use HKCU for armgddn:// protocol (doesn't require admin)
- **Deep Links**: Should now work without running installer as administrator
- **Desktop Shortcut Icon**: Properly set icon for desktop shortcut

## [1.0.15] - 2025-12-05

### Added
- **Browse Button**: Added folder picker for download location selection
- **Skull Logo**: Using actual icon image instead of emoji
- **GitHub Update Checker**: Replaced broken updater plugin with GitHub API check

### Fixed
- **Centered Panels**: Settings and history panels now properly centered
- **Empty State Message**: Fixed JavaScript hardcoded message
- **Max Downloads**: Capped at 3, users can lower to 1 or 2

### Removed
- **Auth Token Field**: Removed from settings UI

## [1.0.14] - 2025-12-05

### Fixed
- **Empty State Message**: Fixed hardcoded message in JavaScript that was overriding HTML
- **Correct Message**: Now shows "Click 'Download with App' on the website"

## [1.0.13] - 2025-12-05

### Fixed
- **Build Script**: Added prebuild script to force delete dist folder before every build
- **Cross-Platform**: Uses Node.js fs.rmSync for Windows/Linux compatibility
- **Guaranteed Fresh HTML**: No possibility of stale cached HTML in builds

## [1.0.12] - 2025-12-05

### Fixed
- **Build Cache**: Force clean checkout in CI to prevent stale dist folder
- **Guaranteed Fresh Frontend**: Rebuilt dist folder with correct UI every time

## [1.0.11] - 2025-12-05

### Fixed
- **Build Process**: Force clean build to ensure all UI changes are included
- **Guaranteed Fresh Build**: No cached artifacts

## [1.0.10] - 2025-12-05

### Fixed
- **Uninstaller**: Now properly removes all app data and installation files
- **Clean Install**: Ensures fresh installs don't inherit old settings

## [1.0.9] - 2025-12-05

### Added
- **Tray Menu**: Right-click tray icon now shows Show and Quit options

### Fixed
- **Protocol Registration**: Fixed executable path in NSIS installer hooks
- **Deep Link**: Improved protocol handler registration for Windows

## [1.0.8] - 2025-12-05

### Fixed
- **Deep Link Launch**: App now handles deep links when launched from browser
- **Protocol Registration**: NSIS installer hooks properly register armgddn:// protocol

### Changed
- **Branding**: Replaced controller icon (🎮) with skull logo (💀)

## [1.0.7] - 2025-12-05

### Fixed
- **Protocol Registration**: NSIS installer now properly registers armgddn:// protocol
- **Deep Link Support**: "Download with App" button now opens the app automatically
- **Windows Integration**: Desktop and Start Menu shortcuts created during installation

## [1.0.6] - 2025-12-05

### Added
- **Debug Logging**: Added detailed logging for session token flow
- **UI Improvements**: Centered text and fixed empty state message

### Fixed
- **Empty State Message**: Updated to reflect website-only flow

## [1.0.5] - 2025-12-05

### Added
- **Session Token Authentication**: Automatic authentication via website deep links
- **Seamless UX**: Token automatically included when clicking "Download with App"
- **Progress Monitoring**: Download progress now properly tracked and displayed in browser

### Changed
- **Removed Manual Input**: No more manual manifest URL entry - website-only flow
- **Simplified Interface**: Cleaner UI with instructions to use website button
- **Auto-Start Downloads**: Downloads start automatically when triggered from website

### Fixed
- **401 Errors**: Session token authentication eliminates unauthorized errors
- **Progress Tracking**: Browser now correctly shows real-time download progress

## [1.0.4] - 2025-12-05

### Fixed
- **Auth Token Storage**: Auth token now properly stored in localStorage for progress reporting
- **401 Errors**: Fixed Unauthorized errors when reporting download progress to server
- Token is now available for both backend downloads and frontend progress reporting

## [1.0.3] - 2025-12-05

### Fixed
- **Tray Icon Behavior**: Left-click on tray icon now restores window (was unresponsive)
- **Windows Protocol Registration**: armgddn:// protocol now automatically registered by installer
  - No manual registry file needed
  - "Download with App" button works immediately after installation
  - WiX installer fragment handles registration

### Improved
- Tray icon now properly unminimizes window when clicked
- Right-click tray menu still available for Show/Quit options

## [1.0.2] - 2025-12-05

### Fixed
- **Windows Deep Link Registration**: Fixed `armgddn://` protocol not being registered on Windows
  - "Download with App" button now works properly in browser
  - Windows installer now correctly registers the protocol handler
  - No more "scheme does not have a registered handler" errors

## [1.0.1] - 2025-12-05

### Improved
- **Minimize to Tray**: Clicking the close button (X) now hides the app to system tray instead of closing it
  - App continues running in background for ongoing downloads
  - Right-click tray icon and select "Show" to restore window
  - Use "Quit" from tray menu to actually exit the app
  - Better UX for background download management

## [1.0.0] - 2025-12-05

### Added

#### Core Features
- Deep link integration via `armgddn://` protocol for one-click downloads
- Manifest-based download system from ARMGDDN Browser
- Encrypted rclone config auto-fetch and decryption (AES-256-GCM)
- Pause/Resume support with HTTP Range requests
- Auto-retry mechanism (3 attempts, 2s delay between retries)
- Configurable concurrent downloads (default: 3, max: 10)
- Real-time progress tracking with speed calculation
- Token-based authentication support
- Cross-platform support (Windows, Linux)
- Bundled rclone binaries for all platforms

#### Advanced Features
- **Desktop Notifications**: Native OS notifications when downloads complete
- **Download History**: Persistent tracking with timestamps and file paths
  - View complete download history
  - Clear history with confirmation
  - Automatic history updates on completion
- **System Tray Integration**: 
  - Minimize to system tray
  - Show/Quit menu options
  - Persistent tray icon
- **Advanced Error Recovery**:
  - Disk space checking before downloads (100MB safety buffer)
  - User-friendly error messages with recovery suggestions
  - Network error detection (timeout, connection, request failures)
  - HTTP error handling (401, 403, 404, 429, 5xx)
  - Specific guidance for each error type
- **Download Scheduling**:
  - Schedule downloads for specific date/time
  - Auto-start when scheduled time arrives
  - Manual "Start Now" override
  - Periodic check every minute
  - "Scheduled" state indicator
- **Categories/Tags**:
  - Tag downloads by game or type
  - Visual category badges
  - Organize downloads by category
- **Multi-Language Support (i18n)**:
  - English (en)
  - Spanish (es)
  - French (fr)
  - German (de)
  - Portuguese (pt)
  - 40+ translated strings
  - Language selector in settings
  - Persistent language preference
  - Auto-reload on language change
- **Auto-Update System**:
  - Cryptographic signature verification
  - Automatic update checks
  - Manual update check button
  - Secure update delivery via GitHub Releases

#### UI/UX Improvements
- Modern dark theme with gradient accents
- Responsive layout
- Settings panel with all configuration options
- History panel with clear functionality
- Visual state indicators (queued, downloading, paused, completed, failed, cancelled, scheduled)
- Category badges with blue styling
- Scheduled time display with clock icon
- Error messages with red highlighting
- Progress bars with smooth animations

#### Developer Experience
- GitHub Actions CI/CD pipeline
- Automated builds for Windows and Linux
- Signed releases with cryptographic verification
- Auto-generated update manifests
- Comprehensive README documentation
- Clean codebase with proper error handling

### Infrastructure
- Progress reporting infrastructure (ready for server integration)
- Server URL and auth token configuration
- Extensible architecture for future features

### Security
- AES-256-GCM encryption for rclone config
- Hardcoded encryption key (secure for this use case)
- Token-based authentication
- Cryptographic signature verification for updates
- No sensitive data exposed in logs

### Performance
- Efficient concurrent download management
- Minimal memory footprint
- Fast startup time
- Optimized rclone integration

## [Unreleased]

### Planned Features
- Server progress reporting implementation
- Bandwidth limiting per download
- macOS support
- Additional languages (Japanese, Chinese, Russian, Arabic)
- Cloud sync for settings and history
- Mobile version (iOS/Android)
- Folder organization by category
- Search/filter in download history

---

[1.0.0]: https://github.com/Nildyanna/armgddn-downloader/releases/tag/v1.0.0
