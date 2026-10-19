import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { fetchHomeAd, type HomeAd } from '@/core/services/ad-api'
import { fetchBlobWithTimeout } from '@/lib/fetch-utils'

interface LoadedHomeAd extends HomeAd {
  imageSrc: string
}

export function HomeAdBanner() {
  const [ad, setAd] = useState<LoadedHomeAd | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let active = true
    let imageSrc: string | null = null

    const loadAd = async () => {
      try {
        const nextAd = await fetchHomeAd()
        if (!nextAd) return

        const image = await fetchBlobWithTimeout(nextAd.imageUrl, {
          timeoutMs: 10_000,
          maxBytes: 5 * 1024 * 1024
        })
        if (!image.type.startsWith('image/')) return

        imageSrc = URL.createObjectURL(image)
        if (active) {
          setAd({ ...nextAd, imageSrc })
        } else {
          URL.revokeObjectURL(imageSrc)
          imageSrc = null
        }
      } catch (error) {
        console.warn('[HomeAd] Failed to load advertisement:', error)
      }
    }

    void loadAd()

    return () => {
      active = false
      if (imageSrc) URL.revokeObjectURL(imageSrc)
    }
  }, [])

  if (!ad || dismissed) return null

  const openAd = () => {
    chrome.tabs.create({ url: ad.jumpUrl }).catch(error => {
      console.warn('[HomeAd] Failed to open advertisement:', error)
    })
  }

  const adDomain = (() => {
    try {
      return new URL(ad.jumpUrl).hostname
    } catch {
      return ''
    }
  })()

  return (
    <div className="relative mx-auto mb-2 aspect-[470/111] w-[calc(100%-2.5rem)] max-w-[335px] overflow-hidden rounded-xl border border-white/15 bg-black">
      <button
        type="button"
        data-analytics-outbound="home_ad"
        data-analytics-domain={adDomain}
        onClick={openAd}
        aria-label={`${ad.title}. ${ad.text}`}
        className="block h-full w-full cursor-pointer"
      >
        <img src={ad.imageSrc} alt="" className="h-full w-full object-cover" />
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss advertisement"
        className="absolute right-1 top-1 flex size-6 cursor-pointer items-center justify-center text-white/40 transition-colors hover:text-white/70"
      >
        <Icon icon="lucide:x" width={13} height={13} />
      </button>
    </div>
  )
}
