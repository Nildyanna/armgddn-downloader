# Tasks

## 1. Mobile app scaffold

- [x] 1.1 Create the Expo React Native app structure under `mobile/`.
- [x] 1.2 Add the Expo configuration, entry point, and shared TypeScript config.
- [x] 1.3 Add the basic branded mobile UI shell for the Companion app.

## 2. Download handoff integration

- [x] 2.1 Handle `armgddn://download` deep links in the mobile app.
- [x] 2.2 Resolve browser-issued download tokens into manifest URLs.
- [x] 2.3 Fetch manifests and start downloads using the same server contract as desktop.

## 3. Verification

- [x] 3.1 Validate the OpenSpec change with `openspec validate add-mobile-companion-app --strict`.
- [ ] 3.2 Confirm the mobile app boots and can accept a sample handoff URL.
