// One import for the native UI: Preact + hooks + htm (tagged templates, so no build step). Versions: preact 10.24.3, htm 3.1.1 (MIT, see LICENSE-*).
import { h, render, Fragment } from './preact.mjs';
import { useState, useEffect, useMemo, useRef, useCallback } from './hooks.mjs';
import htm from './htm.mjs';
export const html = htm.bind(h);
export { h, render, Fragment, useState, useEffect, useMemo, useRef, useCallback };
