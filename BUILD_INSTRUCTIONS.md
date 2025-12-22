# Building with GitHub Actions

The app is configured to build automatically using GitHub Actions. Here's how to use it:

## Setup

1. **Create a GitHub repository** for this project (if you haven't already)

2. **Push the code**:
```bash
cd /home/armgddn/ArmgddnDownloader
git init
git add .
git commit -m "Initial commit: ARMGDDN Companion"
git remote add origin https://github.com/YOUR_USERNAME/armgddn-downloader.git
git push -u origin main
```

## Automatic Builds

The GitHub Actions workflow (`.github/workflows/build.yml`) will automatically:

### On Every Push:
- Build for **Windows** (`.exe` installer)
- Build for **Linux** (`.deb` and `.AppImage`)
- Upload build artifacts you can download from the Actions tab

### On Tagged Releases:
When you create a version tag:
```bash
git tag v4.1.28
git push origin v4.1.28
```

GitHub will:
- Build for both platforms
- Create a GitHub Release
- Attach all installers to the release
- Users can download directly from GitHub Releases page

## Downloading Built Apps

### From Actions Tab:
1. Go to your repo on GitHub
2. Click "Actions" tab
3. Click on the latest successful workflow run
4. Scroll to "Artifacts" section
5. Download `linux-build` or `windows-build`

### From Releases (for tagged versions):
1. Go to your repo on GitHub
2. Click "Releases" on the right sidebar
3. Download the installer for your platform

## Build Outputs

**Linux**:
- `armgddn-downloader_0.1.0_amd64.deb` - Debian/Ubuntu installer
- `armgddn-downloader_0.1.0_amd64.AppImage` - Universal Linux app

**Windows**:
- `ARMGDDN Companion_0.1.0_x64-setup.exe` - Windows installer

## Manual Build (if needed)

If you want to build locally instead:

**Windows**:
```bash
npm install
npm run build:win
```

**Linux** (with sudo):
```bash
npm install
npm run build:linux
```

## Troubleshooting

**Build fails on GitHub Actions**:
- Check the Actions tab for error logs
- Ensure all dependencies are listed in `Cargo.toml` and `package.json`

**Can't push to GitHub**:
- Make sure you've created the repository on GitHub first
- Check your Git credentials are configured

**Want to test before pushing**:
- Use `act` tool to run GitHub Actions locally
- Or build on a local machine with proper dependencies

## Next Steps

1. Push this code to GitHub
2. Wait for Actions to complete (~10-15 minutes)
3. Download the built installers
4. Test on Windows and Linux
5. Distribute to users!
