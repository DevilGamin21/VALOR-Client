# VALOR Client — Release Process

## Prerequisites

- Node.js 22+ and npm installed
- GitHub Personal Access Token (fine-grained) with **Contents: Read and write** on `DevilGamin21/VALOR-Client`
  - Generate at: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
  - Set expiration to 90 days or longer
- `GH_TOKEN` environment variable set to your token

## Release Method (Local)

Build and upload from your machine. This is the standard release flow.

```bash
export GH_TOKEN="gho_your_token_here"

# Windows (primary)
npm run release:win

# Linux (optional — can cross-compile from Windows)
npm run release:linux
```

Each command: patch bump → compile → package → upload to GitHub Releases.

Both upload to the **same release** — electron-builder detects the existing release by tag and adds artifacts to it. Run `release:win` first, then `release:linux` if you want cross-platform.

### Build Without Upload

Use when you want to test the build locally or upload manually later.

```bash
# Build locally (no upload)
npm run build:win          # Windows — produces dist/VALOR-Setup.exe
npm run build:linux        # Linux — produces dist/*.AppImage + dist/*.deb

# Skip version bump if already bumped
npm run build:win:nobump
npm run build:linux:nobump
```

Then commit, push, and create the GitHub Release manually (see Manual Upload section below).

---

## Release Artifacts

A complete cross-platform release has these assets in the GitHub Release:

| File | Platform | Purpose |
|------|----------|---------|
| `latest.yml` | Windows | electron-updater version manifest |
| `VALOR-Setup.exe` | Windows | NSIS installer (~90 MB) |
| `VALOR-Setup.exe.blockmap` | Windows | Delta-update metadata |
| `latest-linux.yml` | Linux | electron-updater version manifest |
| `VALOR-Setup.AppImage` | Linux | Portable Linux app |
| `VALOR-Setup.deb` | Linux | Debian/Ubuntu package |

Windows auto-update requires: `latest.yml` + `VALOR-Setup.exe` + blockmap.
Linux AppImage auto-update requires: `latest-linux.yml` + AppImage.
The `.deb` does not auto-update (users download manually or use apt).

---

## Manual Upload (curl)

If you need to upload assets manually after creating a local build:

### 1. Commit and push

```bash
git add package.json package-lock.json
git commit -m "v0.1.82"
git push origin main
```

### 2. Create the GitHub Release

```bash
TOKEN="gho_your_token_here"
VERSION="0.1.82"  # match package.json version

curl -s -L -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/DevilGamin21/VALOR-Client/releases" \
  -d "{\"tag_name\":\"v$VERSION\",\"name\":\"v$VERSION\",\"body\":\"Release notes here\",\"draft\":false,\"prerelease\":false}"
```

Note the `id` field in the response — you need it for uploads.

### 3. Upload assets

**Important:** Use `--post301 --location-trusted` and basic auth (`-u`) for `uploads.github.com`.

```bash
RELEASE_ID="294384872"  # from step 2 response

# Windows assets
curl -s -L --post301 --location-trusted -X POST \
  -u "DevilGamin21:$TOKEN" -H "Content-Type: application/yaml" \
  "https://uploads.github.com/repos/DevilGamin21/VALOR-Client/releases/$RELEASE_ID/assets?name=latest.yml" \
  --data-binary @dist/latest.yml

curl -s -L --post301 --location-trusted -X POST \
  -u "DevilGamin21:$TOKEN" -H "Content-Type: application/octet-stream" \
  "https://uploads.github.com/repos/DevilGamin21/VALOR-Client/releases/$RELEASE_ID/assets?name=VALOR-Setup.exe.blockmap" \
  --data-binary @dist/VALOR-Setup.exe.blockmap

curl -s -L --post301 --location-trusted -X POST \
  -u "DevilGamin21:$TOKEN" -H "Content-Type: application/octet-stream" \
  "https://uploads.github.com/repos/DevilGamin21/VALOR-Client/releases/$RELEASE_ID/assets?name=VALOR-Setup.exe" \
  --data-binary @dist/VALOR-Setup.exe

# Linux assets (if built)
curl -s -L --post301 --location-trusted -X POST \
  -u "DevilGamin21:$TOKEN" -H "Content-Type: application/yaml" \
  "https://uploads.github.com/repos/DevilGamin21/VALOR-Client/releases/$RELEASE_ID/assets?name=latest-linux.yml" \
  --data-binary @dist/latest-linux.yml

curl -s -L --post301 --location-trusted -X POST \
  -u "DevilGamin21:$TOKEN" -H "Content-Type: application/octet-stream" \
  "https://uploads.github.com/repos/DevilGamin21/VALOR-Client/releases/$RELEASE_ID/assets?name=VALOR-Setup.AppImage" \
  --data-binary "@dist/VALOR-Setup.AppImage"
```

---

## CI (Alternative)

A GitHub Actions workflow exists that builds both Windows + Linux automatically when a `v*` tag is pushed. This is available as a fallback but **local release is preferred** since it's faster and more reliable.

```bash
npm version patch
git push origin main --tags
```

Monitor at: `https://github.com/DevilGamin21/VALOR-Client/actions`

---

## npm Script Reference

| Script | What it does |
|--------|-------------|
| `npm run build:win` | Patch bump + build + package Windows (local) |
| `npm run build:win:minor` | Minor bump + Windows build |
| `npm run build:win:major` | Major bump + Windows build |
| `npm run build:win:nobump` | Windows build without version change |
| `npm run release:win` | Patch bump + Windows build + upload |
| `npm run build:linux` | Patch bump + build + package Linux (local) |
| `npm run build:linux:nobump` | Linux build without version change |
| `npm run release:linux` | Patch bump + Linux build + upload |
| `npm run package:win` | Quick Windows package (no bump, no upload) |
| `npm run package:linux` | Quick Linux package (no bump, no upload) |

---

## How Auto-Update Works

1. On launch, `electron-updater` fetches the version manifest from the GitHub Release
   - Windows: `latest.yml`
   - Linux: `latest-linux.yml`
2. Compares the version to the running app version
3. If newer, downloads the installer (using blockmap for delta if available)
4. Prompts the user to install

Linux auto-update only works with **AppImage** (the AppImage replaces itself). `.deb` installs don't auto-update.

---

## Auth Header Gotcha

GitHub fine-grained tokens (`gho_` prefix) behave differently on the two endpoints:

| Endpoint | Auth Header |
|----------|-------------|
| `api.github.com` (create release, list assets) | `Authorization: Bearer $TOKEN` |
| `uploads.github.com` (upload assets) | `-u "user:$TOKEN"` with `--post301 --location-trusted` |

Using the wrong auth method returns `401 Bad credentials` or `400 Multipart form data required` (on redirect).
