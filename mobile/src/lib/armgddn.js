import * as FileSystem from 'expo-file-system';

export const API_BASE_URL = 'https://www.armgddnbrowser.com';
const DOWNLOAD_TOKEN_ENDPOINT = '/api/external-download-token/resolve';
const DEFAULT_DOWNLOAD_ROOT_NAME = 'ARMGDDN Downloads';

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

function normalizeHandoffUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (raw.startsWith('armgddn://')) {
    return raw;
  }

  if (raw.startsWith('intent://')) {
    const schemeMatch = raw.match(/;scheme=([^;]+);/i);
    const scheme = schemeMatch ? schemeMatch[1] : '';
    const intentMarkerIndex = raw.indexOf('#Intent');
    const pathPart = intentMarkerIndex > -1 ? raw.slice('intent://'.length, intentMarkerIndex) : '';
    if (scheme && pathPart) {
      return `${scheme}://${pathPart}`;
    }
  }

  const nestedIndex = raw.indexOf('armgddn://');
  if (nestedIndex >= 0) {
    return raw.slice(nestedIndex);
  }

  return raw;
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

function appendToFileUri(baseUri, ...parts) {
  const base = String(baseUri || '').replace(/\/+$/, '');
  const normalized = parts
    .filter(Boolean)
    .map((part) => String(part).replace(/^\/+|\/+$/g, ''))
    .join('/');
  return normalized ? `${base}/${normalized}` : base;
}

function isContentUri(value) {
  return String(value || '').startsWith('content://');
}

function fileNameToMimeType(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.7z')) return 'application/x-7z-compressed';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.rar')) return 'application/vnd.rar';
  if (lower.endsWith('.iso')) return 'application/x-iso9660-image';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.apk')) return 'application/vnd.android.package-archive';
  return 'application/octet-stream';
}

function flattenRelativePathName(value, fallback = 'download') {
  const source = String(value || fallback)
    .replace(/[\\/]+/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();
  return safeName(source || fallback);
}

function shouldAttemptAutoExtract(fileName) {
  return String(fileName || '').toLowerCase().endsWith('.7z');
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
  const normalizedUrl = normalizeHandoffUrl(url);
  try {
    parsed = new URL(normalizedUrl);
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
  const options = arguments.length > 1 && arguments[1] ? arguments[1] : {};
  if (options.destinationRootUri) {
    return String(options.destinationRootUri).trim();
  }

  const parts = [];
  if (manifest?.path) parts.push(...pathSegmentsFromName(manifest.path));
  else if (manifest?.name) parts.push(...pathSegmentsFromName(manifest.name));
  if (!parts.length) parts.push('download');
  return joinFileUri(DEFAULT_DOWNLOAD_ROOT_NAME, ...parts);
}

async function createSafFileWithFallbackName(folderUri, preferredName) {
  const baseName = safeName(preferredName || 'download');
  const dotIndex = baseName.lastIndexOf('.');
  const hasExt = dotIndex > 0;
  const stem = hasExt ? baseName.slice(0, dotIndex) : baseName;
  const ext = hasExt ? baseName.slice(dotIndex) : '';
  const mimeType = fileNameToMimeType(baseName);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = attempt === 0 ? '' : ` (${attempt + 1})`;
    const candidate = `${stem}${suffix}${ext}`;
    try {
      const uri = await FileSystem.StorageAccessFramework.createFileAsync(folderUri, candidate, mimeType);
      return { uri, fileName: candidate };
    } catch (e) {
      // Continue trying alternate names when files already exist.
    }
  }

  throw new Error('Unable to create file in Android Downloads folder');
}

async function writeDownloadedTempFileToSaf(tempFileUri, folderUri, preferredName) {
  const target = await createSafFileWithFallbackName(folderUri, preferredName);
  try {
    await FileSystem.copyAsync({ from: tempFileUri, to: target.uri });
  } catch (copyError) {
    const payload = await FileSystem.readAsStringAsync(tempFileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.writeAsStringAsync(target.uri, payload, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }
  return target;
}

async function downloadSingleFile(file, folderUri, callbacks) {
  const contentUriDestination = isContentUri(folderUri);

  if (contentUriDestination) {
    const flatName = flattenRelativePathName(file.relativePath || file.name || file.url, file.name || 'download');
    const tempDirectory = joinFileUri('_tmp');
    await ensureDirectory(tempDirectory);
    const tempFileUri = appendToFileUri(tempDirectory, `${Date.now()}-${flatName}`);
    const download = FileSystem.createDownloadResumable(
      file.url,
      tempFileUri,
      {},
      (progress) => {
        const totalBytes = Number(progress.totalBytesExpectedToWrite || 0);
        const downloaded = Number(progress.totalBytesWritten || 0);
        const percent = totalBytes > 0 ? Math.min(100, Math.round((downloaded / totalBytes) * 100)) : 0;
        callbacks?.onProgress?.({
          downloaded,
          totalBytes,
          percent,
          fileName: file.name || flatName,
        });
      }
    );

    callbacks?.onFileStart?.(file.name || flatName);
    const result = await download.downloadAsync();
    const sourceUri = result?.uri || tempFileUri;
    const target = await writeDownloadedTempFileToSaf(sourceUri, folderUri, flatName);
    try {
      await FileSystem.deleteAsync(sourceUri, { idempotent: true });
    } catch (e) {
      // Ignore cleanup failures for temp files.
    }

    return target.uri;
  }

  const targetSegments = pathSegmentsFromName(file.relativePath || file.name || file.url);
  const fileName = targetSegments.pop() || safeName(file.name || 'download');
  const subdirUri = targetSegments.length ? appendToFileUri(folderUri, ...targetSegments) : folderUri;
  await ensureDirectory(subdirUri);

  const fileUri = appendToFileUri(subdirUri, fileName);
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

  const options = callbacks?.options || {};
  const rootUri = buildDownloadRoot(manifest, options);
  if (!isContentUri(rootUri)) {
    await ensureDirectory(rootUri);
  }

  const totalBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  let downloadedBytes = 0;
  const extraction = {
    requested: false,
    attempted: false,
    extracted: 0,
    skipped: 0,
    reason: '',
  };

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

    const nameForExtraction = file.relativePath || file.name;
    if (shouldAttemptAutoExtract(nameForExtraction)) {
      extraction.requested = true;
      extraction.attempted = true;
      extraction.skipped += 1;
      extraction.reason = 'Automatic .7z extraction is not supported in this mobile build yet.';
      callbacks.onExtraction?.({
        fileName: file.name,
        fileUri,
        extracted: false,
        deletedOriginal: false,
        reason: extraction.reason,
      });
    }
  }

  const message = extraction.requested
    ? `Download complete. ${extraction.reason}`
    : 'Download complete';

  return {
    success: true,
    message,
    rootUri,
    fileCount: files.length,
    totalBytes,
    extraction,
  };
}
