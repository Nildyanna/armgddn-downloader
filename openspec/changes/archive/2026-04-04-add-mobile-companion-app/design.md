# Context

The existing ARMGDDN Companion is an Electron desktop app. The browser already hands off downloads via a tokenized `armgddn://download` deep link that resolves to a manifest URL and then to signed file URLs. The mobile app should reuse that same server contract so the browser does not need a separate mobile-only flow.

## Goals / Non-Goals

- Goals:
  - Create a cross-platform mobile Companion for Android and iOS.
  - Reuse the existing browser-issued download token and manifest resolution flow.
  - Start downloads automatically when a valid handoff arrives.
  - Show download status and progress in a simple mobile UI.
- Non-Goals:
  - Replacing the desktop Electron app.
  - Building a full desktop-grade queue/history/settings surface on day one.
  - Introducing a second backend contract for mobile.

## Decisions

- Decision: Use Expo React Native.
  - Reason: It matches the JavaScript ecosystem already used by the repo and gives one codebase for Android and iOS.
- Decision: Keep the browser/server contract unchanged.
  - Reason: The browser already minting tokens and resolving manifests is the authoritative flow.
- Decision: Download files locally with a mobile filesystem/download layer.
  - Reason: Mobile cannot rely on the desktop Electron + rclone model.
- Decision: Treat mobile as a separate app package under `mobile/`.
  - Reason: It avoids destabilizing the existing Electron build while letting us iterate independently.

## Risks / Trade-offs

- Mobile file downloads may be more constrained than desktop downloads, especially on iOS.
- Background download behavior may differ by platform and OS version.
- Some desktop-only features like tray behavior and rclone-specific retry handling will not carry over directly.

## Migration Plan

1. Add the mobile app scaffold alongside the existing Electron app.
2. Implement the deep-link/token/manifest flow first.
3. Add a simple download screen with progress and error states.
4. Validate the browser handoff end-to-end on mobile.

## Open Questions

- Should the first release save files into an app-local cache or expose a share/export flow?
- Should we persist download history on mobile in the first iteration?
- Do we want a separate mobile app name/icon or the same Companion branding?
