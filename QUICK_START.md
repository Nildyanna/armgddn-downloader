# Quick Start: Deploy ARMGDDN Downloader

## Step 1: Push to GitHub

```bash
cd /home/armgddn/ArmgddnDownloader

# Commit the code
git commit -m "Initial commit: Production-ready ARMGDDN Downloader"

# Create GitHub repo at https://github.com/new
# Then add it as remote (replace YOUR_USERNAME):
git remote add origin https://github.com/YOUR_USERNAME/armgddn-downloader.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 2: Wait for Build

- Go to your repo on GitHub
- Click "Actions" tab
- Watch the build progress (~10-15 minutes)
- Both Windows and Linux builds will run in parallel

## Step 3: Download Built Apps

Once the build completes:

1. Click on the successful workflow run
2. Scroll to "Artifacts" section
3. Download:
   - `linux-build` - Contains `.deb` and `.AppImage`
   - `windows-build` - Contains `.exe` installer

## Step 4: Test the Apps

**Windows**:

- Run the `.exe` installer
- App installs to Program Files
- Test manifest fetching and downloads

**Linux**:

- Install `.deb`: `sudo dpkg -i armgddn-downloader_*.deb`
- Or run `.AppImage` directly (no install needed)
- Test manifest fetching and downloads

## Step 5: Distribute to Users

Upload the installers to:

- Your website downloads page
- GitHub Releases (for version tags)
- Direct links to users

## Creating Releases

For versioned releases:

```bash
# Update version in src-tauri/Cargo.toml
# Then tag and push:
git tag v1.0.0
git push origin v1.0.0
```

GitHub will automatically:

- Build both platforms
- Create a GitHub Release
- Attach installers to the release

## What Users Need to Do

1. Download installer for their platform
2. Install the app
3. Open ARMGDDN Browser website
4. Navigate to a game/folder
5. Click "Download with App" button (you'll add this)
6. Copy the manifest URL
7. Paste into the downloader app
8. Downloads start on their machine!

## Server Integration

Add this button to your website where you show folder downloads:

```javascript
<button onclick="showManifestUrl('${folderName}')">📥 Download with App</button>

<script>
function showManifestUrl(folderName) {
    const filePath = currentPath.length > 0 
        ? `${currentPath.join('/')}/${folderName}` 
        : folderName;
    
    const manifestUrl = `${window.location.origin}/api/download-manifest?remote=${encodeURIComponent(currentRemote)}&path=${encodeURIComponent(filePath)}`;
    
    prompt('Copy this URL to ARMGDDN Downloader:', manifestUrl);
}
</script>
```

## Troubleshooting

**Build fails on GitHub**:

- Check Actions logs for errors
- Ensure all files are committed

**Can't create GitHub repo**:

- Make sure you're logged into GitHub
- Repository name must be unique

**App doesn't work**:

- Check that `/api/download-manifest` endpoint is accessible
- Verify signed URLs in manifest are valid
- Test with a small file first

## Next Steps

1. ✅ Push to GitHub (Step 1)
2. ⏳ Wait for build (Step 2)
3. 📦 Download and test (Steps 3-4)
4. 🚀 Distribute to users (Step 5)

**Your server load will drop dramatically once users adopt the app!**
