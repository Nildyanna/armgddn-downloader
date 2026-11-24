'use strict';
// Mirror cooldowns: which mirrors to avoid for a while after they refuse or fail (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const { logToFile } = require('./log');
const { normalizeMirrorKey } = require('./util');

function pruneMirrorCooldowns(now = Date.now()) {
  try {
    for (const [mirror, until] of ctx.mirrorCooldowns.entries()) {
      if (!Number.isFinite(Number(until)) || Number(until) <= now) {
        ctx.mirrorCooldowns.delete(mirror);
      }
    }
  } catch (e) { }
}

function markMirrorCooldown(mirror, reason, ttlMs = ctx.MIRROR_COOLDOWN_MS) {
  const key = normalizeMirrorKey(mirror);
  if (!key) return false;
  const until = Date.now() + Math.max(60 * 1000, Number(ttlMs) || ctx.MIRROR_COOLDOWN_MS);
  ctx.mirrorCooldowns.set(key, until);
  try {
    logToFile(`[MirrorCooldown] ${key} cooldown=${Math.round((until - Date.now()) / 1000)}s reason=${reason || 'unknown'}`);
  } catch (e) { }
  return true;
}

function clearMirrorCooldown(mirror) {
  const key = normalizeMirrorKey(mirror);
  if (!key) return false;
  return ctx.mirrorCooldowns.delete(key);
}

function getActiveMirrorAvoidList(additionalAvoid = []) {
  const avoid = new Set();
  try {
    const now = Date.now();
    pruneMirrorCooldowns(now);
    for (const [mirror, until] of ctx.mirrorCooldowns.entries()) {
      if (Number(until) > now) avoid.add(normalizeMirrorKey(mirror));
    }
  } catch (e) { }

  try {
    const extras = Array.isArray(additionalAvoid) ? additionalAvoid : [additionalAvoid];
    for (const entry of extras) {
      const key = normalizeMirrorKey(entry);
      if (key) avoid.add(key);
    }
  } catch (e) { }

  return Array.from(avoid).filter(Boolean);
}

module.exports = { pruneMirrorCooldowns, markMirrorCooldown, clearMirrorCooldown, getActiveMirrorAvoidList };
