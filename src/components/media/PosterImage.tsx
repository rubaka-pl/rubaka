import { ImageOff } from 'lucide-react'
import { useState } from 'react'
import { useSettings } from '@/features/settings/settings-store'
import { CATEGORY_CONFIG } from '@/lib/categories'
import { cn } from '@/lib/utils'
import type { MediaCategory } from '@/types/db'

/** Lazy poster with a designed fallback when there is no image or it fails to load. */
export function PosterImage({ src, title, category, className, eager, sizes }: {
  src: string | null | undefined
  title: string
  category?: MediaCategory
  className?: string
  eager?: boolean
  sizes?: string
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const failed = !!src && failedSrc === src
  const loaded = !!src && loadedSrc === src
  const Icon = category ? CATEGORY_CONFIG[category].icon : ImageOff
  // 18+ categories (Doujinshi) stay blurred until hovered, unless turned off in Settings.
  const blurAdult = useSettings().blurDoujinshi
  const blur = !!category && CATEGORY_CONFIG[category].adult === true && blurAdult

  return (
    <div className={cn('relative aspect-[2/3] overflow-hidden rounded-md bg-surface-2', className)}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          sizes={sizes}
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
          className={cn('size-full object-cover transition-[opacity,filter] duration-300', loaded ? 'opacity-100' : 'opacity-0', blur && 'scale-110 blur-xl hover:scale-100 hover:blur-0')}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-surface-2 to-surface-hover p-2 text-center">
          <Icon className="size-6 text-fg-3" aria-hidden />
          <span className="line-clamp-3 text-[11px] font-medium leading-tight text-fg-3">{title}</span>
        </div>
      )}
    </div>
  )
}
