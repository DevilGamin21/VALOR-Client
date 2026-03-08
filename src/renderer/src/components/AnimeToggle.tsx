import { useSearchParams } from 'react-router-dom'

export default function AnimeToggle() {
  const [searchParams, setSearchParams] = useSearchParams()
  const active = searchParams.get('anime') === '1'

  function toggle() {
    const params = new URLSearchParams(searchParams)
    if (active) {
      params.delete('anime')
    } else {
      params.set('anime', '1')
    }
    setSearchParams(params, { replace: true })
  }

  return (
    <button
      data-focusable
      onClick={toggle}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
        active
          ? 'bg-purple-500 text-white'
          : 'bg-white/10 text-white/70 hover:bg-white/20'
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${active ? 'bg-white' : 'bg-white/30'}`} />
      Anime
    </button>
  )
}
