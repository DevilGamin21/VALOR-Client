// Channel identity for THIS build. Baked in at compile time from the
// VALOR_CHANNEL env var via electron.vite.config.ts. The __CHANNEL_ID__
// global is a literal string substituted by Vite's `define`.

import { CHANNELS, type ChannelId, type ChannelDefinition } from './channels'

declare const __CHANNEL_ID__: string

export const CHANNEL_ID = __CHANNEL_ID__ as ChannelId

export const CHANNEL: ChannelDefinition = CHANNELS[CHANNEL_ID]
