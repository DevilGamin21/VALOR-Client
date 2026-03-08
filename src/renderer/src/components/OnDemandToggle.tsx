import { useSearchParams } from 'react-router-dom'

export default function OnDemandToggle() {
  const [searchParams, setSearchParams] = useSearchParams()
  const active = searchParams.get('ondemand') === '1'

  function toggle() {
    const params = new URLSearchParams(searchParams)
    if (active) {
      params.delete('ondemand')
    } else {
      params.set('ondemand', '1')
    }
    setSearchParams(params, { replace: true })
  }

  return (
    <button
      data-focusable
      onClick={toggle}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
        active
          ? 'bg-white text-black'
          : 'bg-white/10 text-white/70 hover:bg-white/20'
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-white/30'}`}
      />
      On Demand
    </button>
  )
}
