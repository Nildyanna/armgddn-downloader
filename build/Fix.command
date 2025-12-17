#!/bin/bash
set -euo pipefail

APP_BUNDLE_NAME="ARMGDDN Companion.app"

CANDIDATES=(
  "/Applications/${APP_BUNDLE_NAME}"
  "$HOME/Applications/${APP_BUNDLE_NAME}"
)

TARGET=""
for c in "${CANDIDATES[@]}"; do
  if [ -d "$c" ]; then
    TARGET="$c"
    break
  fi
done

if [ -z "$TARGET" ]; then
  echo "Could not find ${APP_BUNDLE_NAME} in /Applications or ~/Applications."
  echo "Please drag ${APP_BUNDLE_NAME} into Applications first, then run this again."
  read -r -p "Press Enter to exit..." _
  exit 1
fi

echo "Fixing Gatekeeper quarantine + signing for: $TARGET"
echo

echo "1) Removing quarantine attribute (requires admin password)"
sudo xattr -c -r "$TARGET"

echo "2) Ad-hoc signing the app bundle (requires admin password)"
sudo codesign --force --deep --sign - "$TARGET"

echo
echo "Done. You should be able to open the app now."
read -r -p "Press Enter to exit..." _
