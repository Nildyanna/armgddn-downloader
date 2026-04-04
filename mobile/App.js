import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { ProgressBar } from './src/components/ProgressBar';
import {
  API_BASE_URL,
  downloadFilesFromManifest,
  fetchManifestFromUrl,
  parseHandoffUrl,
} from './src/lib/armgddn';

const APP_TOKEN_KEY = 'armgddn.mobile.appToken';

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
  const [manifestUrl, setManifestUrl] = useState('');
  const [handoffUrl, setHandoffUrl] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [currentFile, setCurrentFile] = useState('');
  const [downloadTarget, setDownloadTarget] = useState('');
  const [connectionState, setConnectionState] = useState('idle');
  const [appToken, setAppToken] = useState('');
  const [lastError, setLastError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [testUrl, setTestUrl] = useState('');
  const [downloadHistory, setDownloadHistory] = useState([]);
  const mountedRef = useRef(true);
  const downloadHistoryRef = useRef([]);
  const appTokenRef = useRef('');
  const isBusyRef = useRef(false);

  const canStart = useMemo(() => !!handoffUrl.trim() || !!testUrl.trim(), [handoffUrl, testUrl]);

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
        setAppToken(storedToken);
      }
    } catch (e) {
      // ignore secure-store failures
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

  async function onUrl(event) {
    const incomingUrl = typeof event === 'string' ? event : event?.url;
    if (!incomingUrl) return;
    setHandoffUrl(incomingUrl);
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
      setAppToken(nextToken);
      await maybeStoreAppToken(nextToken);
      setManifestUrl(parsed.manifestUrl);
      setDownloadTarget(parsed.label || 'download');
      setConnectionState('manifest-ready');
      setStatus('Fetching manifest');
      setStatusDetail(parsed.label ? `Preparing ${parsed.label}` : 'Preparing the download payload.');

      const manifest = await fetchManifestFromUrl(parsed.manifestUrl, parsed.token);
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
      });

      if (!mountedRef.current) return;
      setDownloadProgress(100);
      setStatus('Completed');
      setStatusDetail(result?.message || 'All files were downloaded successfully.');
      setConnectionState('completed');
      const historyEntry = {
        name: parsed.label || manifest.name || manifest.path || 'download',
        manifestUrl: parsed.manifestUrl,
        completedAt: new Date().toISOString(),
        totalBytes: total,
        fileCount: result?.fileCount || (manifest.files ? manifest.files.length : 0),
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
      Alert.alert('Download failed', message);
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

  async function onStartPressed() {
    const url = handoffUrl.trim() || testUrl.trim();
    if (!url) {
      Alert.alert('Missing link', 'Paste a download handoff URL first.');
      return;
    }
    await handleHandoffUrl(url);
  }

  function renderBytes(value) {
    const n = Number(value) || 0;
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    const amount = n / Math.pow(1024, i);
    return `${amount.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
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

        <Section title="Download progress">
          <ProgressBar value={downloadProgress} />
          <Text style={styles.metaText}>{Math.round(downloadProgress)}%</Text>
          <Text style={styles.metaText}>{renderBytes(downloadedBytes)} / {renderBytes(totalBytes)}</Text>
        </Section>

        <Section title="Open a handoff URL">
          <TextInput
            value={handoffUrl}
            onChangeText={setHandoffUrl}
            placeholder="armgddn://download?..."
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <TextInput
            value={testUrl}
            onChangeText={setTestUrl}
            placeholder="Paste a test link here"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <TouchableOpacity style={[styles.button, (!canStart || isBusy) && styles.buttonDisabled]} onPress={onStartPressed} disabled={!canStart || isBusy}>
            <Text style={styles.buttonText}>{isBusy ? 'Working...' : 'Start download'}</Text>
          </TouchableOpacity>
        </Section>

        <Section title="Connection">
          <Text style={styles.metaText}>API base: {API_BASE_URL}</Text>
          <Text style={styles.metaText}>Token cached: {appToken ? 'yes' : 'no'}</Text>
          {!!manifestUrl && <Text style={styles.metaText}>Manifest: {manifestUrl}</Text>}
          <Text style={styles.metaText}>Last link: {handoffUrl || 'none yet'}</Text>
          <TouchableOpacity style={styles.linkButton} onPress={() => Linking.openURL(API_BASE_URL)}>
            <Text style={styles.linkText}>Open ARMGDDN Browser</Text>
          </TouchableOpacity>
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
});
