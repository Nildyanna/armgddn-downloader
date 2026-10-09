"""Emulator test for the Android app: landscape layout and remote / D-pad navigation.

Usage: python3 e2e/emulator_test.py phone|tv <screenshot dir>
The app must already be installed. Everything is read from the accessibility tree, so it needs no human and no real device.
"""
import os
import sys
import time

from ui import PKG, adb, bounds, by_id, check, dump, finish, focused, screen_size, screenshot, wait_for

mode, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)


def launch():
    if mode == "tv":
        adb("shell", "am", "start", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LEANBACK_LAUNCHER", "-n", f"{PKG}/.MainActivity")
    else:
        adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")


def rotate(landscape):
    adb("shell", "settings", "put", "system", "accelerometer_rotation", "0")
    adb("shell", "settings", "put", "system", "user_rotation", "1" if landscape else "0")
    time.sleep(4)


def left(root, rid):
    n = by_id(root, rid)
    return bounds(n)[0] if n is not None else None


adb("shell", "settings", "put", "global", "hide_error_dialogs", "1", check=False)   # no crash / not-responding boxes over the app
time.sleep(20)                                                                       # let a freshly booted emulator settle
adb("shell", "pm", "grant", PKG, "android.permission.POST_NOTIFICATIONS", check=False)
launch()
root = wait_for("section-status")
check(root is not None, "app starts and shows the Status section")
if root is None:
    screenshot(f"{out}/{mode}-launch-failed.png")
    adb("logcat", "-d", "-t", "200", check=False)
    finish()

# Leanback launch entry (what an Android TV home screen uses)
resolved = adb("shell", "cmd", "package", "resolve-activity", "--brief", "-c", "android.intent.category.LEANBACK_LAUNCHER", PKG, check=False)
check(PKG in resolved, "the app can be launched from the Android TV home screen (LEANBACK_LAUNCHER)")

if mode == "phone":
    rotate(False)
    root = wait_for("section-status")
    check(by_id(root, "layout-narrow") is not None, "portrait uses the single-column layout")
    a, b = left(root, "section-status"), left(root, "section-recent-downloads")
    check(a is not None and (b is None or abs(a - b) < 10), f"portrait stacks the sections in one column (x {a} vs {b}; Recent downloads may be below the fold)")
    screenshot(f"{out}/phone-portrait.png")
    rotate(True)

root = wait_for("section-status")
sw, sh = screen_size()
check(sw > sh, f"the screen is landscape ({sw}x{sh})")
check(by_id(root, "layout-wide") is not None, "landscape uses the two-column layout")
a = left(root, "section-status")
b = left(root, "section-recent-downloads")
check(a is not None and b is not None and b - a > 300, f"landscape puts Recent downloads in a second column (x {a} vs {b})")
screenshot(f"{out}/{mode}-landscape.png")

# D-pad / remote navigation: press Down repeatedly and record what has focus
time.sleep(8)       # let the update check finish so its button is there
seen = []
for i in range(14):
    adb("shell", "input", "keyevent", "KEYCODE_DPAD_DOWN")
    time.sleep(0.7)
    root = dump()
    name, bnd = focused(root) if root is not None else (None, None)
    if name and (not seen or seen[-1] != name):
        seen.append(name)
    if i == 3:
        screenshot(f"{out}/{mode}-dpad-focus.png")
print("focus order:", seen)
check(len(seen) >= 2, f"the D-pad moves focus between controls ({len(seen)} distinct: {', '.join(seen)})")
check(any(s.startswith("btn-") for s in seen), "buttons can take focus from the D-pad")
adb("shell", "input", "keyevent", "KEYCODE_DPAD_UP")
time.sleep(0.7)
back = focused(dump())[0]
check(back is not None, f"focus is still on a control after pressing Up ({back})")

# the focused control must be on screen (the list scrolls to it)
root = dump()
name, bnd = focused(root)
sw, sh = screen_size()
if bnd:
    check(0 <= bnd[1] and bnd[3] <= sh + 2, f"the focused control is scrolled into view ({bnd})")

if mode == "phone":
    rotate(False)
    root = wait_for("section-status")
    check(root is not None and by_id(root, "layout-narrow") is not None, "rotating back to portrait restores the single column")

crash = adb("logcat", "-d", "-s", "AndroidRuntime:E", check=False)
check("FATAL EXCEPTION" not in crash, "the app did not crash during the test")
finish()
