import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { ProgressBar } from './src/components/ProgressBar';
import {
  API_BASE_URL,
  downloadFilesFromManifest,
  fetchManifestFromUrl,
  parseHandoffUrl,
  readAndroidDirectory,
  supportsNativeAndroidDownloader,
} from './src/lib/armgddn';

const APP_TOKEN_KEY = 'armgddn.mobile.appToken';
const ANDROID_DOWNLOADS_URI_KEY = 'armgddn.mobile.androidDownloadsUri';
const ANDROID_DOWNLOAD_DIR_KEY = 'armgddn.mobile.androidDownloadDir';
const SAF_ONLY_FOLDER_LABEL = 'Selected folder (internal)';
const GITHUB_RELEASES_LATEST_URL = 'https://api.github.com/repos/Nildyanna/armgddn-downloader/releases/latest';
const GITHUB_RELEASES_PAGE_URL = 'https://github.com/Nildyanna/armgddn-downloader/releases/latest';

function compareVersions(a, b) {
  const partsA = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i += 1) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

function getAppVersion() {
  return (
    Constants.expoConfig?.version ||
    Constants.manifest?.version ||
    '0.0.0'
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function App() {
  const [status, setStatus] = useState('Waiting for a download link');
  const [statusDetail, setStatusDetail] = useState('Open a download on the website and let it hand off to this app.');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [currentFile, setCurrentFile] = useState('');
  const [downloadTarget, setDownloadTarget] = useState('');
  const [downloadRootUri, setDownloadRootUri] = useState('');
  const [downloadFolderUri, setDownloadFolderUri] = useState('');
  const [downloadFolderEntries, setDownloadFolderEntries] = useState([]);
  const [downloadFolderLoading, setDownloadFolderLoading] = useState(false);
  const [downloadFolderError, setDownloadFolderError] = useState('');
  const [customAndroidDownloadDir, setCustomAndroidDownloadDir] = useState('');
  const [connectionState, setConnectionState] = useState('idle');
  const [lastError, setLastError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [downloadHistory, setDownloadHistory] = useState([]);
  const [updateState, setUpdateState] = useState({
    checking: true,
    available: false,
    currentVersion: getAppVersion(),
    latestVersion: '',
    releaseUrl: GITHUB_RELEASES_PAGE_URL,
    error: '',
  });
  const mountedRef = useRef(true);
  const downloadHistoryRef = useRef([]);
  const appTokenRef = useRef('');
  const isBusyRef = useRef(false);
  const customAndroidDownloadDirRef = useRef('');

  useEffect(() => {
    mountedRef.current = true;
    bootstrap();
    const sub = Linking.addEventListener('url', onUrl);
    return () => {
      mountedRef.current = false;
      sub?.remove?.();
    };
  }, []);

  async function bootstrap() {
    try {
      const storedToken = await SecureStore.getItemAsync(APP_TOKEN_KEY);
      if (storedToken) {
        appTokenRef.current = storedToken;
      }
    } catch (e) {
      // ignore secure-store failures
    }

    if (Platform.OS === 'android') {
      try {
        const storedDir = await SecureStore.getItemAsync(ANDROID_DOWNLOAD_DIR_KEY);
        if (storedDir) {
          customAndroidDownloadDirRef.current = storedDir;
          setCustomAndroidDownloadDir(storedDir);
        } else {
          // SAF-only mode: derive a display value from the stored SAF URI so
          // the UI reflects the active destination after a restart.
          const storedSafUri = await SecureStore.getItemAsync(ANDROID_DOWNLOADS_URI_KEY);
          if (storedSafUri) {
            const display = safTreeUriToFilePath(storedSafUri) || SAF_ONLY_FOLDER_LABEL;
            customAndroidDownloadDirRef.current = display;
            setCustomAndroidDownloadDir(display);
          }
        }
      } catch (e) {
        // ignore secure-store failures
      }
    }

    try {
      const rawHistory = await SecureStore.getItemAsync('armgddn.mobile.history');
      if (rawHistory) {
        const parsedHistory = JSON.parse(rawHistory);
        if (Array.isArray(parsedHistory)) {
          const nextHistory = parsedHistory.slice(0, 5);
          downloadHistoryRef.current = nextHistory;
          setDownloadHistory(nextHistory);
        }
      }
    } catch (e) {
      // ignore history load failures
    }

    void checkForAppUpdate();

    try {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        await onUrl({ url: initialUrl });
        return;
      }
    } catch (e) {
      // ignore
    }

    setConnectionState('ready');
  }

  async function checkForAppUpdate() {
    const currentVersion = getAppVersion();
    if (!mountedRef.current) return;
    setUpdateState((prev) => ({
      ...prev,
      checking: true,
      currentVersion,
      error: '',
    }));

    try {
      const response = await fetch(GITHUB_RELEASES_LATEST_URL, {
        headers: {
          'User-Agent': 'ARMGDDN-Companion-Mobile',
          Accept: 'application/vnd.github+json',
        },
      });
      const release = await response.json();
      if (!response.ok || !release || typeof release !== 'object') {
        throw new Error(`Update check failed (HTTP ${response.status})`);
      }

      const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
      const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

      if (!mountedRef.current) return;
      setUpdateState({
        checking: false,
        available: hasUpdate,
        currentVersion,
        latestVersion,
        releaseUrl: release.html_url || GITHUB_RELEASES_PAGE_URL,
        error: '',
      });
    } catch (error) {
      if (!mountedRef.current) return;
      setUpdateState({
        checking: false,
        available: false,
        currentVersion,
        latestVersion: '',
        releaseUrl: GITHUB_RELEASES_PAGE_URL,
        error: error?.message ? String(error.message) : 'Unable to check for updates',
      });
    }
  }

  async function openUpdatePage() {
    const targetUrl = updateState.releaseUrl || GITHUB_RELEASES_PAGE_URL;
    try {
      await Linking.openURL(targetUrl);
    } catch (error) {
      const message = error?.message ? String(error.message) : 'Unable to open update page';
      Alert.alert('Update unavailable', message);
    }
  }

  async function onUrl(event) {
    const incomingUrl = typeof event === 'string' ? event : event?.url;
    if (!incomingUrl) return;
    await handleHandoffUrl(incomingUrl);
  }

  async function handleHandoffUrl(url) {
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    setIsBusy(true);
    setLastError('');
    setConnectionState('resolving');
    setStatus('Resolving download');
    setStatusDetail('Checking the browser-issued token and manifest URL.');

    try {
      const currentToken = appTokenRef.current || '';
      const parsed = await parseHandoffUrl(url, currentToken || null, API_BASE_URL);
      const nextToken = parsed.token || currentToken || '';
      appTokenRef.current = nextToken;
      await maybeStoreAppToken(nextToken);
      setDownloadTarget(parsed.label || 'download');
      setConnectionState('manifest-ready');
      setStatus('Fetching manifest');
      setStatusDetail(parsed.label ? `Preparing ${parsed.label}` : 'Preparing the download payload.');

      const manifest = await fetchManifestFromUrl(parsed.manifestUrl, parsed.token);
      // On Android with the native downloader, pass the user-configured directory
      // (or undefined to use the default public Downloads folder). SAF folder
      // selection is only needed as a fallback when the native downloader is unavailable.
      const androidDestDir = supportsNativeAndroidDownloader()
        ? customAndroidDownloadDirRef.current
        : undefined;
      const androidDownloadsUri = supportsNativeAndroidDownloader()
        ? null
        : await getAndroidDownloadsFolderUri();
      const total = manifest.totalSize || manifest.files?.reduce((sum, item) => sum + Number(item?.size || 0), 0) || 0;
      setTotalBytes(total);
      setDownloadedBytes(0);
      setDownloadProgress(0);
      setCurrentFile('');
      setConnectionState('downloading');
      setStatus('Downloading');
      setStatusDetail(manifest.name || manifest.path || 'Starting file downloads.');

      const result = await downloadFilesFromManifest(manifest, {
        onFileStart: (fileName) => {
          if (!mountedRef.current) return;
          setCurrentFile(fileName);
        },
        onProgress: ({ downloaded, totalBytes: totalForFile, percent, fileName }) => {
          if (!mountedRef.current) return;
          setCurrentFile(fileName || '');
          setDownloadedBytes(downloaded);
          setTotalBytes(total || totalForFile || 0);
          setDownloadProgress(percent);
        },
        options: {
          destinationRootUri: androidDownloadsUri || undefined,
          androidDestDir: androidDestDir,
        },
      });

      if (!mountedRef.current) return;
      setDownloadProgress(100);
      setStatus('Completed');
      setStatusDetail(result?.message || 'All files were downloaded successfully.');
      setConnectionState('completed');
      setDownloadRootUri(result?.rootUri || '');
      setDownloadFolderUri(result?.rootUri || '');
      setDownloadFolderEntries([]);
      setDownloadFolderError('');
      const historyEntry = {
        name: parsed.label || manifest.name || manifest.path || 'download',
        manifestUrl: parsed.manifestUrl,
        completedAt: new Date().toISOString(),
        totalBytes: total,
        fileCount: result?.fileCount || (manifest.files ? manifest.files.length : 0),
        rootUri: result?.rootUri || '',
      };
      const nextHistory = [historyEntry, ...downloadHistoryRef.current].slice(0, 5);
      downloadHistoryRef.current = nextHistory;
      setDownloadHistory(nextHistory);
      try {
        await SecureStore.setItemAsync('armgddn.mobile.history', JSON.stringify(nextHistory));
      } catch (e) {
        // ignore history save failures
      }
    } catch (error) {
      if (!mountedRef.current) return;
      const message = error?.message ? String(error.message) : 'Failed to start download';
      setLastError(message);
      setConnectionState('error');
      setStatus('Error');
      setStatusDetail(message);

      const isFolderError = Platform.OS === 'android' && (
        message.includes('folder') ||
        message.includes('Storage access') ||
        message.includes('SAF') ||
        message.includes('Downloads location')
      );

      if (isFolderError) {
        Alert.alert('Download failed', message, [
          { text: 'OK', style: 'cancel' },
          {
            text: 'Change Folder',
            onPress: async () => {
              try {
                await SecureStore.deleteItemAsync(ANDROID_DOWNLOADS_URI_KEY);
              } catch (e) {
                // ignore
              }
            },
          },
        ]);
      } else {
        Alert.alert('Download failed', message);
      }
    } finally {
      if (mountedRef.current) {
        isBusyRef.current = false;
        setIsBusy(false);
      }
    }
  }

  async function maybeStoreAppToken(token) {
    if (!token) return;
    try {
      await SecureStore.setItemAsync(APP_TOKEN_KEY, token);
    } catch (e) {
      // ignore storage failures
    }
  }

  function looksLikeArmgddnDownloadsFolder(uri) {
    const rawUri = String(uri || '');
    let decoded = rawUri;
    try {
      decoded = decodeURIComponent(rawUri);
    } catch (e) {
      // Fall back to the raw URI if percent-encoding is malformed.
    }
    return decoded.toLowerCase().includes('armgddn downloads');
  }

  async function canReadSafUri(uri) {
    if (!uri || Platform.OS !== 'android') return false;
    const saf = FileSystem.StorageAccessFramework;
    if (!saf?.readDirectoryAsync) return false;
    try {
      await saf.readDirectoryAsync(uri);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function getAndroidDownloadsFolderUri() {
    if (Platform.OS !== 'android') return '';
    const saf = FileSystem.StorageAccessFramework;
    if (!saf?.requestDirectoryPermissionsAsync) {
      throw new Error('Android Downloads folder access is unavailable in this build.');
    }

    try {
      const stored = await SecureStore.getItemAsync(ANDROID_DOWNLOADS_URI_KEY);
      if (stored && await canReadSafUri(stored)) {
        return stored;
      }
    } catch (e) {
      // ignore secure-store read failures
    }

    const permission = await saf.requestDirectoryPermissionsAsync();
    if (!permission?.granted || !permission?.directoryUri) {
      throw new Error('Storage access is required. Please select a folder to save downloads into.');
    }

    try {
      await SecureStore.setItemAsync(ANDROID_DOWNLOADS_URI_KEY, permission.directoryUri);
    } catch (e) {
      // ignore secure-store write failures
    }

    return permission.directoryUri;
  }

  function renderBytes(value) {
    const n = Number(value) || 0;
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    const amount = n / Math.pow(1024, i);
    return `${amount.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
  }

  function joinLocalUri(baseUri, name) {
    if (String(baseUri || '').startsWith('content://')) {
      return String(name || '');
    }
    const base = String(baseUri || '').replace(/\/+$/, '');
    const segment = encodeURIComponent(String(name || '').replace(/^\/+|\/+$/g, ''));
    return `${base}/${segment}`;
  }

  function parseSafDisplayName(uri) {
    const raw = String(uri || '');
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch (e) {
      decoded = raw;
    }
    const tail = decoded.split('/').pop() || decoded;
    const colonIndex = tail.lastIndexOf(':');
    if (colonIndex > -1 && colonIndex + 1 < tail.length) {
      return tail.slice(colonIndex + 1);
    }
    return tail || 'item';
  }

  async function loadFolderEntries(folderUri) {
    const targetUri = String(folderUri || '').trim();
    if (!targetUri) return;
    setDownloadFolderLoading(true);
    setDownloadFolderError('');
    try {
      if (Platform.OS === 'android' && targetUri.startsWith('content://') && FileSystem.StorageAccessFramework?.readDirectoryAsync) {
        const uris = await FileSystem.StorageAccessFramework.readDirectoryAsync(targetUri);
        const entries = (Array.isArray(uris) ? uris : []).map((uri) => ({
          name: parseSafDisplayName(uri),
          uri,
          isDirectory: false,
        }));
        entries.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        setDownloadFolderEntries(entries);
        return;
      }

      if (supportsNativeAndroidDownloader() && targetUri.startsWith('file://')) {
        const entries = await readAndroidDirectory(targetUri);
        setDownloadFolderEntries(entries);
        return;
      }

      const names = await FileSystem.readDirectoryAsync(targetUri);
      const entries = await Promise.all((Array.isArray(names) ? names : []).map(async (name) => {
        const uri = joinLocalUri(targetUri, name);
        let isDirectory = false;
        try {
          const info = await FileSystem.getInfoAsync(uri);
          isDirectory = !!info?.isDirectory;
        } catch (e) {
          // ignore info failures and treat as a file
        }
        return { name, uri, isDirectory };
      }));
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
      setDownloadFolderEntries(entries);
    } catch (error) {
      const message = error?.message ? String(error.message) : 'Unable to read download folder';
      setDownloadFolderEntries([]);
      setDownloadFolderError(message);
    } finally {
      setDownloadFolderLoading(false);
    }
  }

  async function openDownloadedFolder(folderUri = downloadRootUri) {
    const targetUri = String(folderUri || '').trim();
    if (!targetUri) {
      Alert.alert('No downloads yet', 'Complete a download first, then open the downloaded folder from here.');
      return;
    }
    setDownloadFolderUri(targetUri);
    await loadFolderEntries(targetUri);
  }

  async function openFolderItem(item) {
    if (!item?.uri) return;
    if (item.isDirectory) {
      await openDownloadedFolder(item.uri);
      return;
    }

    try {
      const targetUri = Platform.OS === 'android' && !String(item.uri).startsWith('content://')
        ? await FileSystem.getContentUriAsync(item.uri)
        : item.uri;
      await Linking.openURL(targetUri);
    } catch (error) {
      const message = error?.message ? String(error.message) : 'Unable to open file';
      Alert.alert('Open failed', message);
    }
  }

  async function refreshDownloadedFolder() {
    if (!downloadFolderUri) {
      await openDownloadedFolder(downloadRootUri);
      return;
    }
    await loadFolderEntries(downloadFolderUri);
  }

  // Converts a SAF tree URI (e.g. content://...externalstorage.../tree/primary%3ADownload)
  // to an absolute file path (/storage/emulated/0/Download) for the native downloader.
  // Returns null when the URI refers to a path that cannot be expressed as a simple file path.
  function safTreeUriToFilePath(treeUri) {
    try {
      const decoded = decodeURIComponent(String(treeUri || ''));
      const match = decoded.match(/\/tree\/primary:(.*)$/);
      if (match) {
        const rel = match[1];
        return rel ? `/storage/emulated/0/${rel}` : '/storage/emulated/0';
      }
    } catch (e) {
      // ignore conversion failures
    }
    return null;
  }

  async function pickDownloadFolder() {
    const saf = FileSystem.StorageAccessFramework;
    if (!saf?.requestDirectoryPermissionsAsync) {
      Alert.alert('Not supported', 'Folder selection is not available on this device.');
      return;
    }
    try {
      const permission = await saf.requestDirectoryPermissionsAsync();
      if (!permission?.granted || !permission?.directoryUri) {
        return;
      }
      const safUri = permission.directoryUri;
      // Always store the SAF URI so the SAF-mode fallback can use it.
      try {
        await SecureStore.setItemAsync(ANDROID_DOWNLOADS_URI_KEY, safUri);
      } catch (e) {
        // ignore
      }
      // When the native downloader is available, convert the SAF URI to a
      // plain file path so it can be passed directly to react-native-blob-util.
      if (supportsNativeAndroidDownloader()) {
        const filePath = safTreeUriToFilePath(safUri);
        if (!filePath) {
          Alert.alert(
            'Folder not supported',
            'The selected folder cannot be used with the native downloader. ' +
            'Please choose a folder under "Internal storage" (e.g. Download).'
          );
          return;
        }
        customAndroidDownloadDirRef.current = filePath;
        setCustomAndroidDownloadDir(filePath);
        try {
          await SecureStore.setItemAsync(ANDROID_DOWNLOAD_DIR_KEY, filePath);
        } catch (e) {
          // ignore
        }
      } else {
        // SAF-only mode: show the decoded SAF path in the UI and persist the
        // display value so it remains durable across restarts.
        const display = safTreeUriToFilePath(safUri) || SAF_ONLY_FOLDER_LABEL;
        customAndroidDownloadDirRef.current = display;
        setCustomAndroidDownloadDir(display);
        try {
          await SecureStore.setItemAsync(ANDROID_DOWNLOAD_DIR_KEY, display);
        } catch (e) {
          // ignore
        }
      }
    } catch (error) {
      const message = error?.message ? String(error.message) : 'Unable to select folder';
      Alert.alert('Folder selection failed', message);
    }
  }

  async function resetDownloadFolder() {
    customAndroidDownloadDirRef.current = '';
    setCustomAndroidDownloadDir('');
    try {
      await SecureStore.deleteItemAsync(ANDROID_DOWNLOAD_DIR_KEY);
      await SecureStore.deleteItemAsync(ANDROID_DOWNLOADS_URI_KEY);
    } catch (e) {
      // ignore
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ExpoStatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>ARMGDDN Companion</Text>
        <Text style={styles.subtitle}>Mobile download handoff for Android and iPhone</Text>

        <Section title="Status">
          <View style={styles.statusRow}>
            <View style={[styles.dot, connectionState === 'error' && styles.dotError, connectionState === 'completed' && styles.dotSuccess, connectionState === 'downloading' && styles.dotActive]} />
            <Text style={styles.statusText}>{status}</Text>
          </View>
          <Text style={styles.detailText}>{statusDetail}</Text>
          {!!currentFile && <Text style={styles.metaText}>Current file: {currentFile}</Text>}
          {!!downloadTarget && <Text style={styles.metaText}>Target: {downloadTarget}</Text>}
          {!!lastError && <Text style={[styles.metaText, styles.errorText]}>Error: {lastError}</Text>}
        </Section>

        <Section title="App update">
          {updateState.checking ? (
            <Text style={styles.metaText}>Checking for updates...</Text>
          ) : updateState.available ? (
            <>
              <Text style={styles.detailText}>
                Update available: v{updateState.latestVersion} is newer than your installed v{updateState.currentVersion}.
              </Text>
              <TouchableOpacity style={styles.updateButton} onPress={openUpdatePage}>
                <Text style={styles.updateButtonText}>Update App</Text>
              </TouchableOpacity>
            </>
          ) : updateState.error ? (
            <Text style={[styles.metaText, styles.errorText]}>Update check failed: {updateState.error}</Text>
          ) : (
            <Text style={styles.metaText}>You&apos;re on the latest version (v{updateState.currentVersion}).</Text>
          )}
        </Section>

        <Section title="Download folder">
          {Platform.OS === 'android' ? (
            <>
              <Text style={styles.metaText}>
                Base download folder:{' '}
                <Text style={styles.folderPathText}>
                  {customAndroidDownloadDir || 'Downloads (default)'}
                </Text>
              </Text>
              <View style={styles.folderActionsRow}>
                <TouchableOpacity style={styles.secondaryButton} onPress={pickDownloadFolder} disabled={isBusy}>
                  <Text style={styles.secondaryButtonText}>Choose Folder</Text>
                </TouchableOpacity>
                {!!customAndroidDownloadDir && (
                  <TouchableOpacity style={styles.secondaryButton} onPress={resetDownloadFolder} disabled={isBusy}>
                    <Text style={styles.secondaryButtonText}>Reset to Default</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.metaText}>
                Tap "Choose Folder" to select where downloads are saved. The default is the public Android Downloads folder.
              </Text>
            </>
          ) : (
            <Text style={styles.metaText}>Download folder selection is available on Android only.</Text>
          )}
        </Section>

        <Section title="Download progress">
          <ProgressBar value={downloadProgress} />
          <Text style={styles.metaText}>{Math.round(downloadProgress)}%</Text>
          <Text style={styles.metaText}>{renderBytes(downloadedBytes)} / {renderBytes(totalBytes)}</Text>
        </Section>

        <Section title="Recent downloads">
          {downloadHistory.length === 0 ? (
            <Text style={styles.metaText}>No downloads completed yet.</Text>
          ) : (
            downloadHistory.map((item, index) => (
              <View key={`${item.completedAt}-${index}`} style={styles.historyItem}>
                <Text style={styles.historyTitle}>{item.name}</Text>
                <Text style={styles.metaText}>{item.fileCount || 0} files • {renderBytes(item.totalBytes || 0)}</Text>
                <Text style={styles.metaText}>{new Date(item.completedAt).toLocaleString()}</Text>
              </View>
            ))
          )}
        </Section>

        <Section title="Downloaded files">
          {downloadRootUri ? (
            <>
              <Text style={styles.metaText}>
                {Platform.OS === 'android'
                  ? `Stored in: ${downloadRootUri || 'Downloads'}`
                  : 'Stored in app space on this device.'}
              </Text>
              <Text style={styles.metaText} numberOfLines={2}>Folder: {downloadFolderUri || downloadRootUri}</Text>
              <View style={styles.folderActionsRow}>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => openDownloadedFolder(downloadRootUri)}>
                  <Text style={styles.secondaryButtonText}>Open Downloaded Folder</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={refreshDownloadedFolder}>
                  <Text style={styles.secondaryButtonText}>Refresh</Text>
                </TouchableOpacity>
              </View>
              {downloadFolderLoading ? <Text style={styles.metaText}>Loading folder...</Text> : null}
              {!!downloadFolderError && <Text style={[styles.metaText, styles.errorText]}>Folder error: {downloadFolderError}</Text>}
              {!downloadFolderLoading && !downloadFolderError && downloadFolderEntries.length === 0 ? (
                <Text style={styles.metaText}>Open the folder to see files here.</Text>
              ) : null}
              {downloadFolderEntries.map((item) => (
                <TouchableOpacity key={item.uri} style={styles.folderItem} onPress={() => openFolderItem(item)}>
                  <Text style={styles.folderItemIcon}>{item.isDirectory ? '📁' : '📄'}</Text>
                  <View style={styles.folderItemBody}>
                    <Text style={styles.folderItemName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.metaText}>{item.isDirectory ? 'Folder' : 'File'}</Text>
                  </View>
                  <Text style={styles.folderItemChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </>
          ) : (
            <Text style={styles.metaText}>No completed download folder yet.</Text>
          )}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  content: {
    padding: 20,
    gap: 14,
  },
  brand: {
    color: '#f8fafc',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginTop: 6,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 15,
    marginBottom: 6,
  },
  section: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  sectionTitle: {
    color: '#e2e8f0',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 99,
    backgroundColor: '#64748b',
  },
  dotActive: {
    backgroundColor: '#38bdf8',
  },
  dotSuccess: {
    backgroundColor: '#22c55e',
  },
  dotError: {
    backgroundColor: '#ef4444',
  },
  statusText: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '700',
  },
  detailText: {
    color: '#cbd5e1',
    lineHeight: 20,
  },
  metaText: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
  },
  errorText: {
    color: '#fca5a5',
  },
  folderPathText: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#020617',
    color: '#f8fafc',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  button: {
    backgroundColor: '#0ea5e9',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 15,
  },
  updateButton: {
    backgroundColor: '#16a34a',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  updateButtonText: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 15,
  },
  linkButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: '#38bdf8',
  },
  linkText: {
    color: '#38bdf8',
    fontWeight: '700',
    paddingBottom: 2,
  },
  historyItem: {
    backgroundColor: '#020617',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 3,
  },
  historyTitle: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 14,
  },
  folderActionsRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  secondaryButton: {
    backgroundColor: '#111827',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#e2e8f0',
    fontWeight: '700',
  },
  folderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#020617',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  folderItemIcon: {
    fontSize: 20,
  },
  folderItemBody: {
    flex: 1,
    minWidth: 0,
  },
  folderItemName: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 14,
  },
  folderItemChevron: {
    color: '#64748b',
    fontSize: 24,
    lineHeight: 24,
    fontWeight: '700',
  },
});
