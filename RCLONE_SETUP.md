# Rclone Setup Guide - Maximum Security Mode

This guide explains how to set up the downloader app with encrypted rclone config for maximum security.

## Security Model

**What users will NEVER see:**
- Your rclone.conf file
- Storage provider credentials
- Actual storage URLs or paths
- Remote names or structure

**What happens:**
1. Server provides encrypted rclone config
2. App decrypts config locally
3. App runs rclone on user's machine
4. Files download directly from storage
5. **Zero URL exposure, zero server load**

## Step 1: Encrypt Your Rclone Config

On your server:

```bash
cd /home/armgddn/ArmgddnBrowser

# Encrypt your rclone config
node encrypt-rclone-config.js ~/.config/rclone/rclone.conf "YOUR-STRONG-ENCRYPTION-KEY"
```

This creates `encrypted-rclone-config.txt` with your encrypted config.

**Important:** Choose a strong encryption key and keep it secret!

## Step 2: Add to Server Environment

Add the encrypted config to your server's environment variables:

```bash
# Edit your .env file or add to system environment
ENCRYPTED_RCLONE_CONFIG="<paste-the-encrypted-config-here>"
RCLONE_ENCRYPTION_KEY="YOUR-STRONG-ENCRYPTION-KEY"
```

The encrypted config is a long base64 string from the previous step.

## Step 3: Restart Server

```bash
agbot restart-node
```

The `/api/rclone-config` endpoint is now active and will serve the encrypted config to authenticated users.

## Step 4: Update Download Manifest Format

Your `/api/download-manifest` endpoint needs to return rclone paths instead of URLs:

```json
{
  "success": true,
  "remote": "PC-1",
  "path": "GameName",
  "totalFiles": 10,
  "files": [
    {
      "name": "file1.zip",
      "remote": "PC-1",
      "path": "GameName/file1.zip",
      "size": 1073741824
    }
  ]
}
```

**Note:** No `url` field! Just `remote` and `path`.

## Step 5: Bundle Rclone with the App

### For Windows Build:

1. Download rclone for Windows from https://rclone.org/downloads/
2. Extract `rclone.exe`
3. Place it in `src-tauri/` directory
4. Update `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "resources": ["rclone.exe"]
  }
}
```

### For Linux Build:

1. Download rclone for Linux from https://rclone.org/downloads/
2. Extract `rclone` binary
3. Place it in `src-tauri/` directory
4. Make it executable: `chmod +x src-tauri/rclone`
5. Update `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "resources": ["rclone"]
  }
}
```

## Step 6: Configure the App

Users will need to configure the encryption key in the app settings:

1. Open the app
2. Go to Settings
3. Enter the encryption key (same one you used to encrypt)
4. App will fetch and decrypt the config automatically

## How It Works

### First Launch:
1. User opens app
2. User enters encryption key in settings
3. App calls `/api/rclone-config` (authenticated)
4. Server returns encrypted config
5. App decrypts using the key
6. App saves decrypted config locally
7. Ready to download!

### Downloading:
1. User pastes manifest URL
2. App fetches manifest (gets remote + path for each file)
3. App uses local rclone to download directly from storage
4. **No URLs exposed, no server load**

## Security Benefits

✅ **Zero URL exposure** - Users never see storage URLs
✅ **Credentials protected** - Encrypted config, decrypted locally
✅ **Time-limited access** - Can rotate encryption key anytime
✅ **Server offload** - Downloads happen on user's machine
✅ **Audit trail** - Server logs who fetches config

## Key Rotation

To rotate the encryption key:

1. Encrypt config with new key
2. Update `ENCRYPTED_RCLONE_CONFIG` environment variable
3. Update `RCLONE_ENCRYPTION_KEY` in your secure storage
4. Notify users to update their app settings with new key
5. Old configs stop working automatically

## Troubleshooting

**App says "Decryption failed":**
- User entered wrong encryption key
- Config was encrypted with different key
- Check server logs for the correct key

**App says "Rclone not found":**
- Rclone binary not bundled with app
- Follow Step 5 to bundle rclone

**Downloads fail:**
- Check rclone config is valid
- Test locally: `rclone listremotes --config <decrypted-config>`
- Verify remote names in manifest match config

## Alternative: User-Provided Rclone

Instead of bundling rclone, you can require users to install it:

**Pros:**
- Smaller app size
- Users can update rclone independently

**Cons:**
- Extra setup step for users
- Version compatibility issues

To use this approach, skip Step 5 and document that users need to install rclone from https://rclone.org/

## Next Steps

1. ✅ Encrypt your rclone config (Step 1)
2. ✅ Add to server environment (Step 2)
3. ✅ Restart server (Step 3)
4. ✅ Update manifest format (Step 4)
5. ✅ Bundle rclone (Step 5)
6. ✅ Build and distribute app
7. ✅ Provide encryption key to users

**Your storage credentials are now completely hidden from users!**
