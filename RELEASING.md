# VALOR Client — Release Process

## Prerequisites

- Node.js 22+ and npm installed
- GitHub Personal Access Token (fine-grained) with **Contents: Read and write** on `DevilGamin21/VALOR-Client`
  - Generate at: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
  - Set expiration to 90 days or longer

## Quick Release (Automated)

If you have `GH_TOKEN` set in your environment, `release:win` handles everything:

```bash
export GH_TOKEN="gho_your_token_here"
npm run release:win
```

This runs the full pipeline: patch bump → build → package → upload to GitHub Releases.

## Manual Release (Step by Step)

Use this when the automated upload fails or you need more control.

### 1. Build the installer

```bash
# Patch bump (0.1.59 → 0.1.60) + build + package locally
npm run build:win

# Or skip the version bump if you already bumped manually
npm run build:win:nobump
```

This produces three files in `dist/`:
- `VALOR-Setup.exe` — the NSIS installer (~120 MB)
- `VALOR-Setup.exe.blockmap` — delta-update metadata (~130 KB)
- `latest.yml` — version manifest for electron-updater (~300 B)

### 2. Commit and push

```bash
git add package.json
git commit -m "Bump version to X.Y.Z"
git push origin main
```

### 3. Create the GitHub Release

```bash
TOKEN="gho_your_token_here"
VERSION="0.1.60"  # match package.json version

curl -s -L -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/DevilGamin21/VALOR-Client/releases" \
  -d "{\"tag_name\":\"v$VERSION\",\"name\":\"v$VERSION\",\"body\":\"Release notes here\",\"draft\":false,\"prerelease\":false}"
```

Note the `id` field in the response — you need it for uploads.

### 4. Upload the three assets

**Important:** The upload endpoint (`uploads.github.com`) requires `token` auth, not `Bearer`.

```bash
RELEASE_ID="294384872"  # from step 3 response

# 1. latest.yml
curl -s -L -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/yaml" \
  "https://uploads.github.com/repos/DevilGamin21/VALOR-Client/releases/$RELEASE_ID/assets?name=latest.yml" \
  --data-binary @dist/latest.yml

# 2. Blockmap
curl -s -L -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  "https://uploads.github.com/repos/DevilGamin21/VALOR-Client/releases/$RELEASE_ID/assets?name=VALOR-Setup.exe.blockmap" \
  --data-binary @dist/VALOR-Setup.exe.blockmap

# 3. Installer (large file — may take a few minutes)
curl -s -L -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  "https://uploads.github.com/repos/DevilGamin21/VALOR-Client/releases/$RELEASE_ID/assets?name=VALOR-Setup.exe" \
  --data-binary @dist/VALOR-Setup.exe
```

### 5. Verify

Check the release page: `https://github.com/DevilGamin21/VALOR-Client/releases/tag/vX.Y.Z`

All three assets must be present for auto-update to work:
| File | Purpose |
|------|---------|
| `latest.yml` | electron-updater reads this to detect new versions |
| `VALOR-Setup.exe` | Full installer downloaded by updater |
| `VALOR-Setup.exe.blockmap` | Delta-update support (smaller downloads for minor updates) |

## Auth Header Gotcha

GitHub fine-grained tokens (`gho_` prefix) behave differently on the two endpoints:

| Endpoint | Auth Header |
|----------|-------------|
| `api.github.com` (create release, list assets) | `Authorization: Bearer $TOKEN` |
| `uploads.github.com` (upload assets) | `Authorization: token $TOKEN` |

Using the wrong prefix returns `401 Bad credentials`.

## npm Script Reference

| Script | What it does |
|--------|-------------|
| `npm run build:win` | Patch bump + build + package (local only) |
| `npm run build:win:minor` | Minor bump + build + package |
| `npm run build:win:major` | Major bump + build + package |
| `npm run build:win:nobump` | Build + package without version change |
| `npm run release:win` | Patch bump + build + package + upload to GitHub Releases |

## How Auto-Update Works

1. On launch, `electron-updater` fetches `latest.yml` from the GitHub Release
2. Compares the version in `latest.yml` to the running app version
3. If newer, downloads `VALOR-Setup.exe` (using blockmap for delta if available)
4. Prompts the user to install
