# OpenSpec Instructions (ARMGDDN Downloader)

<!-- markdownlint-disable MD013 MD022 MD029 MD032 MD036 -->

These are the OpenSpec instructions for the **ARMGDDN Downloader** Electron app.

This project **reuses the same OpenSpec conventions** as your main ARMGDDN Browser repo. For full details, follow the global instructions you already use there (capabilities, change IDs, ADDED/MODIFIED/REMOVED requirements, scenarios, validation, archiving).

## TL;DR for This Repo

- **Specs live under** `openspec/specs/`.
- **Change proposals live under** `openspec/changes/<change-id>/`.
- **Each change** has:
  - `proposal.md` (why/what/impact)
  - `tasks.md` (implementation checklist)
  - Optional `design.md` (only when needed)
  - One or more spec deltas under `specs/<capability>/spec.md`.
- **Each delta file** uses:
  - `## ADDED Requirements`
  - `## MODIFIED Requirements`
  - `## REMOVED Requirements`
  - `## RENAMED Requirements`
  - Every `### Requirement:` has at least one `#### Scenario:`.
- **Validate strictly** before using a change:
  - `openspec validate <change-id> --strict`

When working in this repo:

- Treat **specs** as the truth of what the Electron downloader **does today**.
- Treat **changes** as proposals for how the downloader **should change**.
- Use **verb-led change IDs** like `add-download-history-filter`, `update-deep-link-security`, `refactor-rclone-path-resolution`.

## When to Create a Proposal

Create an OpenSpec change in this repo when you:

- Add or change **downloader capabilities**, such as:
  - New deep-link actions (beyond `armgddn://download?...`).
  - New download orchestration behavior (queueing, concurrency, retry rules).
  - New UI flows (history filters, settings panels, update flows).
- Make **security-significant** changes:
  - How manifest URLs are validated.
  - How session cookies or tokens are stored/used.
  - How rclone is invoked/parameterized.
- Make **breaking behavior changes** for users.

You can **skip proposals** for:

- Bug fixes that restore the intended behavior already described in specs.
- Minor copy/visual tweaks.
- Non-breaking dependency version bumps.
- CI / packaging tweaks that do not change user-visible behavior.

## Standard Directory Layout

```text
openspec/
├── AGENTS.md         # This file – how to use OpenSpec here
├── project.md        # Project context for ARMGDDN Downloader
├── specs/            # Current truth – capabilities that exist
└── changes/          # Proposals – what should change
    └── archive/      # Archived changes after deployment
```

Follow the **full OpenSpec guidance** you already use (requirements/scenarios formatting, validation commands, archiving flow). This repo’s `openspec/project.md` explains how those concepts map onto the Electron downloader (deep links, rclone downloads, tray behavior, history, updates).
