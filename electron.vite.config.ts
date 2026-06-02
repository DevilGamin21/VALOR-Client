import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

// Channel identity for this build. Set by scripts/build.mjs --channel <id>.
// Defaults to 'stable' so `electron-vite dev` works without ceremony.
const VALOR_CHANNELS = ['stable', 'seth', 'brazen'] as const
const rawChannel = process.env.VALOR_CHANNEL ?? 'stable'
if (!VALOR_CHANNELS.includes(rawChannel as typeof VALOR_CHANNELS[number])) {
  throw new Error(
    `Invalid VALOR_CHANNEL "${rawChannel}". Expected one of: ${VALOR_CHANNELS.join(', ')}`
  )
}
const channelDefine = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __CHANNEL_ID__: JSON.stringify(rawChannel)
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: channelDefine
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    publicDir: resolve('icon'),
    define: channelDefine,
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
