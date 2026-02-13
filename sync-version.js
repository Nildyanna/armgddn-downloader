const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const companionPkgPath = path.join(__dirname, 'package.json');
const browserPkgPath = path.join(__dirname, '..', 'ArmgddnBrowser', 'package.json');
const browserDefaultPhpPath = path.join(__dirname, '..', 'ArmgddnBrowser', 'default.php');

function sync() {
    try {
        // 1. Read current version from Companion package.json
        const companionPkg = JSON.parse(fs.readFileSync(companionPkgPath, 'utf8'));
        const version = companionPkg.version;
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
