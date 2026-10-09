"""Helpers for the emulator test: read the Android accessibility tree (uiautomator dump) and ask questions about it."""
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PKG = "com.armgddn.companion.mobile"


def adb(*args, check=True):
    r = subprocess.run(["adb", *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"adb {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout


def dump():
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml", check=False)
    xml = adb("shell", "cat", "/sdcard/ui.xml", check=False)
    try:
        return ET.fromstring(xml[xml.index("<"):])
    except Exception:
        return None


def bounds(node):
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
    return tuple(int(x) for x in m.groups()) if m else None


def by_id(root, rid):
    for n in root.iter("node"):
        if n.get("resource-id", "").endswith(rid):
            return n
    return None


def focused(root):
    """Name of the focused control: its testID, else its text, else its description."""
    for n in root.iter("node"):
        if n.get("focused") == "true":
            name = n.get("resource-id", "").split("/")[-1] or n.get("content-desc") or n.get("text")
            if name:
                return name, bounds(n)
    return None, None


def wait_for(rid, seconds=90):
    end = time.time() + seconds
    while time.time() < end:
        root = dump()
        if root is not None and by_id(root, rid) is not None:
            return root
        time.sleep(2)
    return None


def screen_size():
    m = re.search(r"(\d+)x(\d+)", adb("shell", "wm", "size"))
    return int(m.group(1)), int(m.group(2))


def screenshot(path):
    with open(path, "wb") as f:
        f.write(subprocess.run(["adb", "exec-out", "screencap", "-p"], capture_output=True).stdout)


failures = []


def check(ok, message):
    print(("PASS " if ok else "FAIL ") + message, flush=True)
    if not ok:
        failures.append(message)


def finish():
    print(f"\n{len(failures)} failure(s)")
    sys.exit(1 if failures else 0)
