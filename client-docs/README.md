# VALOR – Desktop Client Documentation

Documentation for the **VALOR Desktop Client**: a native Windows/Linux application that connects to the VALOR media server and provides desktop-exclusive features on top of Jellyfin streaming.

---

## Quick links

| Doc | Purpose |
|-----|---------|
| [**ARCHITECTURE.md**](./ARCHITECTURE.md) | Tech stack, process model, IPC bridge, CORS bypass, auth |
| [**SETUP.md**](./SETUP.md) | Prerequisites, dev environment, running in development |
| [**BUILD.md**](./BUILD.md) | Building installers, releasing updates, update server setup |
| [**FEATURES.md**](./FEATURES.md) | All implemented client features |
| [**DEVELOPER-GUIDE.md**](./DEVELOPER-GUIDE.md) | File map, conventions, how to add pages and components |

---

## One-line summary

- **Client:** Electron 33 + React 18 + TypeScript, packaged as a native desktop app.
- **Server it talks to:** `https://apiv.dawn-star.co.uk` (Express backend — see `server-docs/`).
- **Primary platform:** Windows (NSIS `.exe` installer). Linux secondary (AppImage / `.deb`).

---

## Relationship to the web app

The VALOR stack has two clients:

| | Web client | Desktop client |
|---|---|---|
| Tech | Next.js 15 (App Router) | Electron + React + Vite |
| URL | https://valor.dawn-star.co.uk | Installed app |
| Auth | HTTP-only cookie (`valor_session`) | JWT in encrypted electron-store |
| Video | HLS.js (browser) | HLS.js (Electron's Chromium) — identical codecs |
| Updates | Redeploy Next.js | Auto-updater via `electron-updater` |
| Desktop features | None | Tray, media keys, native notifications (planned) |

Both clients talk to the **same** backend (`apiv.dawn-star.co.uk`) using the same API endpoints. The desktop client sends `Authorization: Bearer <token>` headers instead of cookies.

---

## Quick start (development)

```bash
cd c:\VALOR-Client
npm install
npm run dev        # launches Electron + Vite dev server with hot reload
```

## Quick build (Windows installer)

```bash
npm run build:win          # bump patch version → build → dist/VALOR-Setup-x.x.x.exe
npm run release:win        # same + upload to update server
```

See [BUILD.md](./BUILD.md) for full details.

---

## New developer checklist

1. Read [ARCHITECTURE.md](./ARCHITECTURE.md) — understand the Electron process model and how IPC works.
2. Follow [SETUP.md](./SETUP.md) — get the dev environment running.
3. Skim [FEATURES.md](./FEATURES.md) — know what already exists.
4. Use [DEVELOPER-GUIDE.md](./DEVELOPER-GUIDE.md) — file locations and common tasks.
5. Reference [BUILD.md](./BUILD.md) before releasing a new installer.
6. For server-side API reference, see `server-docs/` (especially `server-docs/ARCHITECTURE.md` and `../backend/API_DOC.md`).
