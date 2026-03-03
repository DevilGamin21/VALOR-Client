import { useEffect, useState } from 'react'
import { Minus, Square, X } from 'lucide-react'

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.electronAPI.window.isMaximized().then(setMaximized)
    window.electronAPI.window.onMaximizedChange(setMaximized)
  }, [])

  return (
    <div
      className="app-drag h-8 flex-shrink-0 flex items-center justify-between
                  bg-eerie border-b border-dark-border select-none z-50"
    >
      {/* Left: logo */}
      <div className="pl-3 flex items-center">
        <img src="./logo.png" alt="VALOR" className="h-5 w-auto" />
      </div>

      {/* Right: window controls — no-drag so clicks register */}
      <div className="app-no-drag flex h-full">
        <button
          onClick={() => window.electronAPI.window.minimize()}
          className="h-full w-12 flex items-center justify-center
                     text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          title="Minimise"
        >
          <Minus size={12} />
        </button>
        <button
          onClick={() => window.electronAPI.window.maximize()}
          className="h-full w-12 flex items-center justify-center
                     text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          title={maximized ? 'Restore' : 'Maximise'}
        >
          <Square size={10} />
        </button>
        <button
          onClick={() => window.electronAPI.window.close()}
          className="h-full w-12 flex items-center justify-center
                     text-white/40 hover:text-white hover:bg-red-600 transition-colors"
          title="Close"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
