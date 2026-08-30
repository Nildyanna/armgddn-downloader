const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const companionPkgPath = path.join(__dirname, 'package.json');
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

        // 4. Browser Git status check only — this script must NEVER commit or push
        // the Browser repo automatically. It previously did `git add package.json
        // default.php` unconditionally and pushed, which silently swept up and
        // published whatever unrelated working-tree state default.php happened to
        // be in (once reverting live features when the file was mid-edit from
        // other work). Committing default.php belongs to whoever is editing it,
        // reviewed like any other change — never a side effect of a version bump.
        try {
            const browserDir = path.join(__dirname, '..', 'ArmgddnBrowser');
            const status = execSync(`git -C "${browserDir}" status --porcelain -- package.json default.php`, { encoding: 'utf8' });
            if (status.trim()) {
                console.log('Browser package.json/default.php have version-sync changes — review and commit manually:');
                console.log(status);
            } else {
                console.log('Browser repo is already in sync.');
            }
        } catch (err) {
            console.error('Failed to check Browser repository sync status.');
        }

    } catch (err) {
        console.error(`Sync failed: ${err.message}`);
        process.exit(1);
    }
}

sync();
