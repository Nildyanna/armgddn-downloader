const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const companionPkgPath = path.join(__dirname, 'package.json');
const mobilePkgPath = path.join(__dirname, 'mobile', 'package.json');
const mobileAppJsonPath = path.join(__dirname, 'mobile', 'app.json');
const browserPkgPath = path.join(__dirname, '..', 'ArmgddnBrowser', 'package.json');
const browserDefaultPhpPath = path.join(__dirname, '..', 'ArmgddnBrowser', 'default.php');

function runGit(cmd) {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function normalizeVersionFromTag(tag) {
    const t = String(tag || '').trim();
    if (!t) return '';
    const m = t.match(/^v?(\d+\.\d+\.\d+)$/);
    return m ? m[1] : '';
}

function versionToAndroidVersionCode(version) {
    const parts = String(version || '')
        .split('.')
        .map(part => parseInt(part, 10));
    if (parts.length !== 3 || parts.some(num => !Number.isInteger(num) || num < 0)) {
        return null;
    }

    const [major, minor, patch] = parts;
    return major * 1000000 + minor * 1000 + patch;
}

function resolveVersion() {
    try {
        const forced = process.env.ARMGDDN_SYNC_VERSION ? String(process.env.ARMGDDN_SYNC_VERSION).trim() : '';
        if (forced) {
            const n = normalizeVersionFromTag(forced);
            if (n) return n;
        }
    } catch (e) {
    }

    // Prefer the tag exactly at HEAD (this is what we are typically pushing).
    try {
        const exactTag = runGit('git tag --points-at HEAD');
        const first = exactTag.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || '';
        const n = normalizeVersionFromTag(first);
        if (n) return n;
    } catch (e) {
    }

    // Fall back to most recent tag.
    try {
        const lastTag = runGit('git describe --tags --abbrev=0');
        const n = normalizeVersionFromTag(lastTag);
        if (n) return n;
    } catch (e) {
    }

    // Final fallback: Companion package.json
    const companionPkg = JSON.parse(fs.readFileSync(companionPkgPath, 'utf8'));
    return String(companionPkg.version || '').trim();
}

function sync() {
    try {
        // 1. Resolve version (prefer tag at HEAD)
        const version = resolveVersion();
        console.log(`Syncing version: ${version}`);

        // 2. Update Browser package.json
        if (fs.existsSync(browserPkgPath)) {
            const browserPkg = JSON.parse(fs.readFileSync(browserPkgPath, 'utf8'));
            if (browserPkg.version !== version) {
                browserPkg.version = version;
                fs.writeFileSync(browserPkgPath, JSON.stringify(browserPkg, null, 2) + '\n');
                console.log(`Updated Browser package.json to ${version}`);
            } else {
                console.log(`Browser package.json is already at ${version}`);
            }
        } else {
            console.error(`Browser package.json not found at ${browserPkgPath}`);
        }

        // 2b. Update mobile Companion package.json/app.json
        if (fs.existsSync(mobilePkgPath)) {
            const mobilePkg = JSON.parse(fs.readFileSync(mobilePkgPath, 'utf8'));
            if (mobilePkg.version !== version) {
                mobilePkg.version = version;
                fs.writeFileSync(mobilePkgPath, JSON.stringify(mobilePkg, null, 2) + '\n');
                console.log(`Updated mobile package.json to ${version}`);
            } else {
                console.log(`mobile package.json is already at ${version}`);
            }
        } else {
            console.warn(`Mobile package.json not found at ${mobilePkgPath}`);
        }

        if (fs.existsSync(mobileAppJsonPath)) {
            const mobileAppJson = JSON.parse(fs.readFileSync(mobileAppJsonPath, 'utf8'));
            const expo = mobileAppJson && mobileAppJson.expo && typeof mobileAppJson.expo === 'object' ? mobileAppJson.expo : null;
            if (expo && expo.version !== version) {
                expo.version = version;
                fs.writeFileSync(mobileAppJsonPath, JSON.stringify(mobileAppJson, null, 2) + '\n');
                console.log(`Updated mobile app.json to ${version}`);
            } else if (expo) {
                console.log(`mobile app.json is already at ${version}`);
            }

            if (expo && typeof expo.android === 'object' && expo.android) {
                const versionCode = versionToAndroidVersionCode(version);
                if (versionCode) {
                    if (expo.android.versionCode !== versionCode) {
                        expo.android.versionCode = versionCode;
                        fs.writeFileSync(mobileAppJsonPath, JSON.stringify(mobileAppJson, null, 2) + '\n');
                        console.log(`Updated mobile android versionCode to ${versionCode}`);
                    } else {
                        console.log(`mobile android versionCode is already at ${versionCode}`);
                    }
                } else {
                    console.warn(`Could not derive Android versionCode from version ${version}`);
                }
            }
        } else {
            console.warn(`Mobile app.json not found at ${mobileAppJsonPath}`);
        }

        // 3. Update Browser default.php hardcoded fallback
        if (fs.existsSync(browserDefaultPhpPath)) {
            let content = fs.readFileSync(browserDefaultPhpPath, 'utf8');
            // Look for $site_version = '...'; fallback line
            const regex = /(\$site_version\s*=\s*')([^']+)(';)/;
            if (regex.test(content)) {
                const newContent = content.replace(regex, `$1${version}$3`);
                if (newContent !== content) {
                    fs.writeFileSync(browserDefaultPhpPath, newContent);
                    console.log(`Updated Browser default.php fallback to ${version}`);
                } else {
                    console.log(`Browser default.php fallback is already at ${version}`);
                }
            } else {
                console.warn(`Could not find site_version fallback line in default.php`);
            }
        } else {
            console.error(`Browser default.php not found at ${browserDefaultPhpPath}`);
        }

        // 4. Browser Git Operations
        // We only handle the Browser repo here. The Companion push is handled by the user/git hook.
        try {
            const browserDir = path.join(__dirname, '..', 'ArmgddnBrowser');
            console.log('Checking Browser sync status...');

            // Only commit if there are changes
            const status = execSync(`git -C "${browserDir}" status --porcelain`, { encoding: 'utf8' });
            if (status.includes('package.json') || status.includes('default.php')) {
                console.log('Committing and pushing Browser sync changes...');
                execSync(`git -C "${browserDir}" add package.json default.php`, { stdio: 'inherit' });
                // Also update package-lock if it exists
                if (fs.existsSync(path.join(browserDir, 'package-lock.json'))) {
                    try {
                        execSync(`npm --prefix "${browserDir}" install --package-lock-only`, { stdio: 'inherit' });
                        execSync(`git -C "${browserDir}" add package-lock.json`, { stdio: 'inherit' });
                    } catch (e) {
                        console.warn('Failed to update Browser package-lock.json');
                    }
                }
                execSync(`git -C "${browserDir}" commit -m "chore: sync version to ${version}"`, { stdio: 'inherit' });

                execSync(`git -C "${browserDir}" push origin main`, { stdio: 'inherit' });
            } else {
                console.log('Browser repo is already in sync.');
            }
        } catch (err) {
            console.error('Failed to sync Browser repository. Check if it is clean and you have remote access.');
        }

    } catch (err) {
        console.error(`Sync failed: ${err.message}`);
        process.exit(1);
    }
}

sync();
