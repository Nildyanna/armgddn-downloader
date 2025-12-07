# ARMGDDN Downloader

Fast rclone-powered download manager for ARMGDDN content.

## Features

- Deep link support (`armgddn://` protocol)
- Fast downloads using rclone
- Download history
- System tray integration
- Cross-platform (Windows, Linux)

## Development

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build for current platform
npm run build

# Build for specific platform
npm run build:win
npm run build:linux
```

## Building

The app requires rclone binaries in the `rclone/` directory:
- `rclone/win32/rclone.exe` for Windows
- `rclone/linux/rclone` for Linux
- `rclone/darwin/rclone` for macOS

## License

MIT
