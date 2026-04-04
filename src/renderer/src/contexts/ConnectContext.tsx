import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode, useMemo } from 'react'
import { useAuth } from './AuthContext'
import { API_BASE } from '@/services/api'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DeviceState {
  playing: boolean
  positionSeconds: number
  durationSeconds: number
  quality?: string
  audioTracks?: { index: number; label: string; language?: string; active: boolean }[]
  subtitleTracks?: { index: number; label: string; language?: string; active: boolean; isImageBased?: boolean }[]
  mediaMeta?: {
    title?: string
    tmdbId?: number
    type?: string
    seasonNumber?: number
    episodeNumber?: number
    posterUrl?: string | null
    isAnime?: boolean
  } | null
}

export interface RemoteDevice {
  deviceId: string
  deviceName: string
  deviceType: string
  state: DeviceState
}

/** Payload to tell a remote device to start playing something */
export interface PlayItemPayload {
  tmdbId: number
  type: 'movie' | 'tv'
  title: string
  year?: number
  season?: number
  episode?: number
  startPositionTicks?: number
  isAnime?: boolean
}

interface ConnectContextValue {
  connected: boolean
  devices: RemoteDevice[]
  thisDeviceId: string
  /** The device we're currently controlling (null = not controlling anything) */
  targetDevice: RemoteDevice | null
  /** Connect to a device as controller */
  connectTo: (deviceId: string) => void
  /** Disconnect from the controlled device */
  disconnect: () => void
  /** Send a playback command to the target device */
  sendCommand: (targetDeviceId: string, command: string, payload?: Record<string, unknown>) => void
  /** Tell the target device to play specific content */
  playOnTarget: (payload: PlayItemPayload) => void
  pushState: (state: Partial<DeviceState>) => void
  setCommandHandler: (handler: ((cmd: string, payload: Record<string, unknown>) => void) | null) => void
  /** Name of the device currently controlling us (null = not being controlled) */
  controlledBy: string | null
  /** Reject further remote commands */
  rejectControl: () => void
  /** Hostname of this device */
  deviceName: string
}

const ConnectContext = createContext<ConnectContextValue | null>(null)

// ─── Device identity ─────────────────────────────────────────────────────────

function getDeviceId(): string {
  let id = localStorage.getItem('valor_device_id')
  if (!id) {
    id = `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    localStorage.setItem('valor_device_id', id)
  }
  return id
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function ConnectProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [connected, setConnected] = useState(false)
  const [devices, setDevices] = useState<RemoteDevice[]>([])
  const [deviceName, setDeviceName] = useState('PC')
  const [targetDeviceId, setTargetDeviceId] = useState<string | null>(null)
  const [controlledBy, setControlledBy] = useState<string | null>(null)
  const controlRejectedRef = useRef(false)
  const devicesRef = useRef<RemoteDevice[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commandHandlerRef = useRef<((cmd: string, payload: Record<string, unknown>) => void) | null>(null)

  const thisDeviceId = useMemo(() => getDeviceId(), [])

  // Resolve hostname once
  useEffect(() => {
    window.electronAPI.system.hostname().then(setDeviceName).catch(() => setDeviceName('PC'))
  }, [])

  const sendCommand = useCallback((targetId: string, command: string, payload?: Record<string, unknown>) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'command', targetDeviceId: targetId, command, payload: payload || {} }))
  }, [])

  const pushState = useCallback((state: Partial<DeviceState>) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'state', state }))
  }, [])

  const setCommandHandler = useCallback((handler: ((cmd: string, payload: Record<string, unknown>) => void) | null) => {
    commandHandlerRef.current = handler
  }, [])

  const rejectControl = useCallback(() => {
    controlRejectedRef.current = true
    setControlledBy(null)
    // Reset after 30s so future commands work again
    setTimeout(() => { controlRejectedRef.current = false }, 30_000)
  }, [])

  // Controller actions
  const connectTo = useCallback((deviceId: string) => {
    setTargetDeviceId(deviceId)
    console.log('[Connect] Now controlling device:', deviceId)
  }, [])

  const disconnect = useCallback(() => {
    console.log('[Connect] Disconnected from target device')
    setTargetDeviceId(null)
  }, [])

  const playOnTarget = useCallback((payload: PlayItemPayload) => {
    if (!targetDeviceId) return
    sendCommand(targetDeviceId, 'playMedia', payload as unknown as Record<string, unknown>)
  }, [targetDeviceId, sendCommand])

  // Resolve target device from ID
  const targetDevice = useMemo(() => {
    if (!targetDeviceId) return null
    return devices.find(d => d.deviceId === targetDeviceId) ?? null
  }, [targetDeviceId, devices])

  // Auto-disconnect if target device disappears
  useEffect(() => {
    if (targetDeviceId && !devices.some(d => d.deviceId === targetDeviceId)) {
      console.log('[Connect] Target device went offline, disconnecting')
      setTargetDeviceId(null)
    }
  }, [targetDeviceId, devices])

  // WebSocket connection with auto-reconnect
  useEffect(() => {
    if (!token || !deviceName) return
    let disposed = false

    function connect() {
      if (disposed) return
      const parsed = new URL(API_BASE)
      const proto = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
      const params = new URLSearchParams({
        token: token!,
        deviceId: thisDeviceId,
        deviceName,
        deviceType: 'pc',
      })
      const url = `${proto}//${parsed.host}/ws/connect?${params}`
      console.log('[Connect] Connecting to', url.replace(/token=[^&]+/, 'token=***'))

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        console.log('[Connect] Connected')
      }

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>
        try { msg = JSON.parse(event.data as string) } catch { return }

        switch (msg.type) {
          case 'devices': {
            const list = (msg.devices as RemoteDevice[]) || []
            devicesRef.current = list
            setDevices(list)
            break
          }
          case 'deviceState':
            setDevices(prev => prev.map(d =>
              d.deviceId === msg.deviceId
                ? { ...d, state: { ...d.state, ...(msg.state as Partial<DeviceState>) } }
                : d
            ))
            break
          case 'command':
            if (controlRejectedRef.current) break
            if (commandHandlerRef.current) {
              const fromId = msg.fromDeviceId as string | undefined
              if (fromId && (msg.command === 'playMedia' || msg.command === 'play' || msg.command === 'pause' || msg.command === 'seek' || msg.command === 'resume')) {
                const fromDevice = devicesRef.current.find(d => d.deviceId === fromId)
                setControlledBy(fromDevice?.deviceName || fromId)
              }
              commandHandlerRef.current(msg.command as string, (msg.payload as Record<string, unknown>) || {})
            }
            break
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }))
            break
          case 'error':
            console.warn('[Connect] Server error:', msg.message)
            break
        }
      }

      ws.onclose = (e) => {
        setConnected(false)
        wsRef.current = null
        console.log(`[Connect] Closed code=${e.code} reason=${e.reason || 'none'}`)
        // Don't reconnect if effect was cleaned up or close was intentional (1000)
        if (!disposed && e.code !== 1000) {
          reconnectTimer.current = setTimeout(connect, 3000)
        }
      }

      ws.onerror = (e) => {
        console.warn('[Connect] WebSocket error:', e)
      }
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }
      if (wsRef.current) {
        wsRef.current.close(1000, 'cleanup')
        wsRef.current = null
      }
    }
  }, [token, deviceName, thisDeviceId])

  const value = useMemo<ConnectContextValue>(() => ({
    connected,
    devices,
    thisDeviceId,
    targetDevice,
    connectTo,
    disconnect,
    sendCommand,
    playOnTarget,
    pushState,
    setCommandHandler,
    controlledBy,
    rejectControl,
    deviceName,
  }), [connected, devices, thisDeviceId, targetDevice, connectTo, disconnect, sendCommand, playOnTarget, pushState, setCommandHandler, controlledBy, rejectControl, deviceName])

  return (
    <ConnectContext.Provider value={value}>
      {children}
    </ConnectContext.Provider>
  )
}

export function useConnect(): ConnectContextValue | null {
  return useContext(ConnectContext)
}
