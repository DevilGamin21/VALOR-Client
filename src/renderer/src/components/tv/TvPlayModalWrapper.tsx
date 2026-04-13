import { isTv } from '@/hooks/usePlatform'
import PlayModal from '@/components/PlayModal'
import TvDetailPage from '@/components/tv/TvDetailPage'
import type { UnifiedMedia } from '@/types/media'
interface Props { item: UnifiedMedia; onClose: () => void; resumeHint?: { seasonNumber?: number | null; episodeNumber?: number | null; positionTicks?: number } }
export default function TvPlayModalWrapper({ item, onClose, resumeHint }: Props) {
  if (isTv) return <TvDetailPage item={item} onClose={onClose} />
  return <PlayModal item={item} onClose={onClose} resumeHint={resumeHint} />
}
