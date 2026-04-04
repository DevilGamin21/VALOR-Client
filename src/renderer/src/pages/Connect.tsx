import { useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Monitor, Smartphone, Tv, Globe, Cast,
  Volume2, Wifi, WifiOff, Check,
} from 'lucide-react'
import { useConnect, type RemoteDevice } from '@/contexts/ConnectContext'
import { usePlayer } from '@/contexts/PlayerContext'
import { useSettings } from '@/contexts/SettingsContext'

function DeviceIcon({ type, size = 20 }: { type: string; size?: number }) {
  switch (type) {
    case 'tv': return <Tv size={size} />
    case 'mobile': return <Smartphone size={size} />
    case 'pc': return <Monitor size={size} />
    default: return <Globe size={size} />
  }
}

function DeviceCard({
  device,
  isTarget,
  onClick,
}: {
  device: RemoteDevice
  isTarget: boolean
  onClick: () => void
}) {
  const meta = device.state.mediaMeta
  return (
    <motion.button
      data-focusable
      whileHover={{ scale: 1.02 }}
      onClick={onClick}
      className={`w-full text-left rounded-xl p-4 transition border ${
        isTarget
          ? 'bg-emerald-950/40 border-emerald-500/30'
          : 'bg-white/[0.04] border-transparent hover:bg-white/[0.07]'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          isTarget ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/[0.06] text-white/50'
        }`}>
          <DeviceIcon type={device.deviceType} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-white truncate">{device.deviceName}</p>
            {isTarget && <Check size={14} className="text-emerald-400 flex-shrink-0" />}
          </div>
          <p className="text-xs text-white/30 mt-0.5 capitalize">{device.deviceType}</p>
        </div>
        {device.state.playing && (
          <div className="flex items-center gap-1.5 text-green-400 flex-shrink-0">
            <Volume2 size={12} />
            <span className="text-[10px] font-medium">Playing</span>
          </div>
        )}
      </div>
      {meta && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/[0.06]">
          {meta.posterUrl && (
            <img src={meta.posterUrl} alt="" className="w-8 h-12 rounded object-cover flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-white/60 truncate">{meta.title}</p>
            {meta.type === 'tv' && meta.seasonNumber != null && meta.episodeNumber != null && (
              <p className="text-[10px] text-white/30">
                S{String(meta.seasonNumber).padStart(2, '0')}E{String(meta.episodeNumber).padStart(2, '0')}
              </p>
            )}
          </div>
        </div>
      )}
      {isTarget && (
        <p className="text-[10px] text-emerald-400/60 mt-3">
          Connected — play any title to send it to this device
        </p>
      )}
    </motion.button>
  )
}

export default function Connect() {
  const ctx = useConnect()
  const { discordRPC } = useSettings()
  const { isOpen } = usePlayer()

  useEffect(() => {
    if (isOpen || !discordRPC) return
    window.electronAPI.discord.setActivity({
      details: 'VALOR',
      state: 'Connect',
      largeImageKey: 'logo',
      largeImageText: 'VALOR',
    }).catch(() => {})
  }, [isOpen, discordRPC])

  if (!ctx) {
    return (
      <div className="flex items-center justify-center h-64 text-white/30 text-sm">
        Connect is initializing…
      </div>
    )
  }

  const { connected, devices, thisDeviceId, targetDevice, connectTo, disconnect, deviceName: hostName } = ctx
  const otherDevices = devices.filter(d => d.deviceId !== thisDeviceId)

  function handleDeviceClick(deviceId: string) {
    if (targetDevice?.deviceId === deviceId) {
      disconnect()
    } else {
      connectTo(deviceId)
    }
  }

  return (
    <div className="p-6 pb-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-2">
        <Cast size={20} className="text-white/50" />
        <h1 className="text-xl font-bold text-white">Connect</h1>
        <div className={`ml-auto flex items-center gap-1.5 text-xs ${connected ? 'text-green-400' : 'text-white/30'}`}>
          {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>
      <p className="text-sm text-white/30 mb-4">
        Select a device to control. Once connected, playing any title will send it to that device.
      </p>
      <div className="flex items-center gap-2 mb-6 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
        <Monitor size={14} className="text-white/30 flex-shrink-0" />
        <span className="text-xs text-white/40">Your device is visible as</span>
        <span className="text-xs text-white/70 font-medium">{hostName}</span>
      </div>

      {otherDevices.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-white/30">
          <Cast size={40} className="mb-3 opacity-50" />
          <p className="text-sm">No other devices connected</p>
          <p className="text-xs mt-1 text-white/20">Open VALOR on another device to see it here</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {otherDevices.map((d) => (
            <DeviceCard
              key={d.deviceId}
              device={d}
              isTarget={targetDevice?.deviceId === d.deviceId}
              onClick={() => handleDeviceClick(d.deviceId)}
            />
          ))}
        </div>
      )}

      {targetDevice && (
        <div className="mt-6 p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/20">
          <div className="flex items-center gap-2 text-emerald-400 mb-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm font-medium">Controlling {targetDevice.deviceName}</span>
          </div>
          <p className="text-xs text-white/40">
            Browse and play content — it will be sent to {targetDevice.deviceName}. Use the bottom bar to control playback.
          </p>
          <button
            data-focusable
            onClick={disconnect}
            className="mt-3 px-4 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/60 hover:text-white text-xs transition"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
