import * as FileSystem from 'expo-file-system';

export const API_BASE_URL = 'https://www.armgddnbrowser.com';
const DOWNLOAD_TOKEN_ENDPOINT = '/api/external-download-token/resolve';

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function decodeMaybeBase64Url(value) {
  const str = String(value || '').trim();
  if (!str) return '';
  if (str.startsWith('https://')) return str;
  try {
    const decoded = globalThis.atob ? globalThis.atob(str) : '';
    if (decoded && decoded.startsWith('https://')) return decoded;
  } catch (e) {
    // ignore
  }
  return str;
}

function safeName(value) {
  return String(value || 'download')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'download';
}

function pathSegmentsFromName(name) {
  return String(name || '')
    .split('/')
    .map((segment) => safeName(segment))
    .filter(Boolean);
}

function joinFileUri(...parts) {
  const base = String(FileSystem.documentDirectory || 'file:///').replace(/\/+$/, '');
  const normalized = parts
    .filter(Boolean)
    .map((part) => String(part).replace(/^\/+|\/+$/g, ''))
    .join('/');
  return `${base}/${normalized}`;
}

async function ensureDirectory(dirUri) {
  try {
    await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
  } catch (e) {
    // Directory may already exist.
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    json = null;
  }
  return { response, text, json };
}

export async function resolveManifestUrl(downloadToken, token, apiBaseUrl = API_BASE_URL) {
  const rawToken = String(downloadToken || '').trim();
  if (!rawToken) {
    throw new Error('Missing download token');
  }
  const authToken = String(token || '').trim();
  if (!authToken) {
    throw new Error('Missing authentication token');
  }

  const url = new URL(DOWNLOAD_TOKEN_ENDPOINT, apiBaseUrl);
  url.searchParams.set('downloadToken', rawToken);

  const { response, json, text } = await fetchJson(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok || !json || json.success !== true || !json.manifestUrl) {
    const message = (json && (json.error || json.message)) || `Failed to resolve download token (HTTP ${response.status})`;
    throw new Error(`${message}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }

  return {
    manifestUrl: decodeMaybeBase64Url(json.manifestUrl),
    clientType: json.clientType || null,
  };
}

export async function parseHandoffUrl(url, tokenHint, apiBaseUrl = API_BASE_URL) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    throw new Error('Invalid download link');
  }

  if (parsed.protocol !== 'armgddn:') {
    throw new Error('Invalid protocol for download link');
  }

  if (parsed.hostname !== 'download' && parsed.hostname !== 'open') {
    throw new Error('Invalid download link host');
  }

  const manifestFromUrl = parsed.searchParams.get('manifest');
  const downloadToken = parsed.searchParams.get('downloadToken');
  const token = parsed.searchParams.get('token') || tokenHint || '';

  let manifestUrl = decodeMaybeBase64Url(manifestFromUrl || '');
  if (!manifestUrl && downloadToken) {
    const resolved = await resolveManifestUrl(downloadToken, token, apiBaseUrl);
    manifestUrl = resolved.manifestUrl;
  }

  if (!manifestUrl) {
    throw new Error('Invalid download link: missing manifest URL');
  }

  if (!isHttpsUrl(manifestUrl)) {
    throw new Error('Invalid manifest URL');
  }

  return {
    manifestUrl,
    token,
    downloadToken: downloadToken || null,
    label: parsed.searchParams.get('label') || parsed.searchParams.get('name') || '',
    rawUrl: url,
  };
}

export async function fetchManifestFromUrl(manifestUrl, token) {
  const parsed = new URL(manifestUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('Manifest URL must use HTTPS');
  }

  const remote = parsed.searchParams.get('remote') || '';
  const path = parsed.searchParams.get('path') || '';
  if (!remote || !path) {
    throw new Error('Manifest URL is missing remote or path');
  }

  const body = JSON.stringify({ remote, path });
  const { response, json, text } = await fetchJson(parsed.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });

  if (!response.ok || !json || json.success === false) {
    const message = (json && (json.error || json.message)) || `Manifest fetch failed (HTTP ${response.status})`;
    throw new Error(`${message}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }

  return json;
}

function normalizeFiles(manifest) {
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  return files
    .filter((file) => file && file.url)
    .map((file, index) => ({
      url: String(file.url),
      name: safeName(file.name || `file-${index + 1}`),
      size: Number(file.size || 0),
      relativePath: String(file.name || `file-${index + 1}`),
    }));
}

function buildDownloadRoot(manifest) {
  const parts = [];
  if (manifest?.path) parts.push(...pathSegmentsFromName(manifest.path));
  else if (manifest?.name) parts.push(...pathSegmentsFromName(manifest.name));
  if (!parts.length) parts.push('download');
  return joinFileUri('ARMGDDN', ...parts);
}

async function downloadSingleFile(file, folderUri, callbacks) {
  const targetSegments = pathSegmentsFromName(file.relativePath || file.name || file.url);
  const fileName = targetSegments.pop() || safeName(file.name || 'download');
  const subdirUri = targetSegments.length ? joinFileUri(folderUri.replace(String(FileSystem.documentDirectory || ''), ''), ...targetSegments) : folderUri;
  await ensureDirectory(subdirUri);

  const fileUri = joinFileUri(subdirUri.replace(String(FileSystem.documentDirectory || ''), ''), fileName);
  const download = FileSystem.createDownloadResumable(
    file.url,
    fileUri,
    {},
    (progress) => {
      const totalBytes = Number(progress.totalBytesExpectedToWrite || 0);
      const downloaded = Number(progress.totalBytesWritten || 0);
      const percent = totalBytes > 0 ? Math.min(100, Math.round((downloaded / totalBytes) * 100)) : 0;
      callbacks?.onProgress?.({
        downloaded,
        totalBytes,
        percent,
        fileName: file.name || fileName,
      });
    }
  );

  callbacks?.onFileStart?.(file.name || fileName);
  const result = await download.downloadAsync();
  return result?.uri || fileUri;
}

export async function downloadFilesFromManifest(manifest, callbacks = {}) {
  const files = normalizeFiles(manifest);
  if (!files.length) {
    throw new Error('No files found in manifest');
  }

  const rootUri = buildDownloadRoot(manifest);
  await ensureDirectory(rootUri);

  const totalBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  let downloadedBytes = 0;

  for (const file of files) {
    const fileUri = await downloadSingleFile(file, rootUri, {
      onFileStart: callbacks.onFileStart,
      onProgress: (progress) => {
        const currentDownloaded = downloadedBytes + Number(progress.downloaded || 0);
        const percent = totalBytes > 0 ? Math.min(100, Math.round((currentDownloaded / totalBytes) * 100)) : progress.percent || 0;
        callbacks.onProgress?.({
          downloaded: currentDownloaded,
          totalBytes,
          percent,
          fileName: progress.fileName || file.name,
        });
      },
    });

    downloadedBytes += Number(file.size || 0);
    callbacks.onProgress?.({
      downloaded: downloadedBytes,
      totalBytes,
      percent: totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0,
      fileName: file.name,
    });

    if (fileUri) {
      // Keep the output reachable for future share/export support.
    }
  }

  return {
    success: true,
    message: 'Download complete',
    rootUri,
    fileCount: files.length,
    totalBytes,
  };
}
