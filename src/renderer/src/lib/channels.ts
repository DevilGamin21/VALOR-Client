// Channel registry — single source of truth for the desktop client's
// multi-channel system. Each build bakes a single channel id into the
// bundle at compile time via VALOR_CHANNEL env (see electron.vite.config.ts).
//
// Channel naming intentionally uses friendly names ('stable') rather than
// the web frontend's mythological codenames ('nepthys') because desktop
// builds ship as distinct installers ('VALOR-Setup-brazen.exe') and the
// user-visible label needs to be obvious to end users.

export type ChannelId = 'stable' | 'seth' | 'brazen'

export type ChannelDefinition = {
  id: ChannelId
  /** Short label shown in the banner. */
  label: string
  /** Public API hostname for this channel. */
  apiBase: string
  /** Banner colour scheme. */
  tone: 'stable' | 'soak' | 'beta'
}

export const CHANNELS: Record<ChannelId, ChannelDefinition> = {
  stable: {
    id: 'stable',
    label: 'Stable',
    apiBase: 'https://apiv.dawn-star.co.uk',
    tone: 'stable'
  },
  seth: {
    id: 'seth',
    label: 'Soak',
    // Hyphenated host: Cloudflare free-tier SSL only covers a single
    // subdomain level, so a dotted seth.apiv... would fail cert provisioning.
    apiBase: 'https://seth-apiv.dawn-star.co.uk',
    tone: 'soak'
  },
  brazen: {
    id: 'brazen',
    label: 'Beta',
    apiBase: 'https://brazen-apiv.dawn-star.co.uk',
    tone: 'beta'
  }
}

/** Where to send users when they click "Back to stable" from a non-stable
 *  banner. GitHub's `/releases/latest` lands on the most recent release
 *  not marked as pre-release — see electron-builder.yml where stable is
 *  `release` and seth/brazen are `prerelease`. */
export const STABLE_DOWNLOAD_URL =
  'https://github.com/DevilGamin21/VALOR-Client/releases/latest'
