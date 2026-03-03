; ─────────────────────────────────────────────────────────────────────────────
; VALOR Desktop Client — Custom NSIS Installer Branding
; Included by electron-builder before the MUI macro setup.
; ─────────────────────────────────────────────────────────────────────────────

; ── Welcome page ──────────────────────────────────────────────────────────────

!define MUI_WELCOMEPAGE_TITLE "Welcome to VALOR"
!define MUI_WELCOMEPAGE_TEXT \
  "Your native desktop client for the VALOR media server.$\r$\n$\r$\n\
Stream your entire library in full quality — Dolby audio, resume \
playback, P2P on-demand, and desktop-exclusive features.$\r$\n$\r$\n\
Click Next to install."

; ── Finish page ───────────────────────────────────────────────────────────────

!define MUI_FINISHPAGE_TITLE "VALOR is ready"
!define MUI_FINISHPAGE_TEXT \
  "Installation complete.$\r$\n$\r$\n\
VALOR will update automatically — you'll be notified inside the app \
whenever a new version is available.$\r$\n$\r$\n\
Click Finish to launch VALOR."

; ── Finish-page link ──────────────────────────────────────────────────────────
; NOTE: MUI_FINISHPAGE_RUN is defined by electron-builder's assistedInstaller.nsh
;       (which also sets MUI_FINISHPAGE_RUN_FUNCTION to launch the app).
;       Do not redefine it here — it would cause a duplicate-define NSIS error.
!define MUI_FINISHPAGE_LINK          "valor.dawn-star.co.uk"
!define MUI_FINISHPAGE_LINK_LOCATION "https://valor.dawn-star.co.uk"

; ── Uninstaller ───────────────────────────────────────────────────────────────
!define MUI_UNCONFIRMPAGE_TEXT_TOP \
  "VALOR will be removed from your computer.$\r$\n\
Your saved session and preferences will NOT be deleted."
