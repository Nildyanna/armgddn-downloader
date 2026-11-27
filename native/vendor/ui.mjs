// One import for the native UI: Preact + hooks + htm (tagged templates, so no build step). Versions: preact 10.24.3, htm 3.1.1 (MIT, see LICENSE-*).
import { h, render, Fragment, Component } from './preact.mjs';
import { useState, useEffect, useMemo, useRef, useCallback } from './hooks.mjs';
import htm from './htm.mjs';
import { wrapH } from '../../renderer/native/i18n.mjs';
// Text and labels go through the app's language (renderer/native/i18n.mjs); English when none is loaded.
export const html = htm.bind(wrapH(h));
export { h, render, Fragment, Component, useState, useEffect, useMemo, useRef, useCallback };
