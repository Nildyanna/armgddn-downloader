// Expo config plugin: lets the Android app be installed and launched from an Android TV home screen and a Meta Quest,
// where there may be no touchscreen. It only adds manifest entries; nothing else changes for phones.
const { withAndroidManifest } = require('@expo/config-plugins');

const QUEST_DEVICES = 'quest|quest2|quest3|quest3s|questpro';

function ensureFeature(manifest, name, required) {
  const list = (manifest['uses-feature'] = manifest['uses-feature'] || []);
  if (!list.some((f) => f.$['android:name'] === name)) list.push({ $: { 'android:name': name, 'android:required': String(required) } });
}

module.exports = function withTvAndQuest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    ensureFeature(manifest, 'android.software.leanback', false);          // may run on Android TV, not required
    ensureFeature(manifest, 'android.hardware.touchscreen', false);       // a remote or controller is enough
    const app = manifest.application[0];
    const main = (app.activity || []).find((a) => a.$['android:name'] === '.MainActivity');
    if (main) {
      const filter = (main['intent-filter'] || []).find((f) => (f.action || []).some((a) => a.$['android:name'] === 'android.intent.action.MAIN'));
      if (filter) {
        filter.category = filter.category || [];
        if (!filter.category.some((c) => c.$['android:name'] === 'android.intent.category.LEANBACK_LAUNCHER')) {
          filter.category.push({ $: { 'android:name': 'android.intent.category.LEANBACK_LAUNCHER' } });
        }
      }
    }
    app['meta-data'] = app['meta-data'] || [];
    if (!app['meta-data'].some((m) => m.$['android:name'] === 'com.oculus.supportedDevices')) {
      app['meta-data'].push({ $: { 'android:name': 'com.oculus.supportedDevices', 'android:value': QUEST_DEVICES } });
    }
    return cfg;
  });
};
