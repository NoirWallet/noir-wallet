import { fetchJsonWithTimeout } from '@/lib/fetch-utils'

const AD_API_URL = 'https://api.zknoir.com/v1/ad'

export interface HomeAd {
  title: string
  text: string
  imageUrl: string
  jumpUrl: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null

  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function parseHomeAd(value: unknown): HomeAd | null {
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.text !== 'string') {
    return null
  }

  const title = value.title.trim()
  const text = value.text.trim()
  const imageUrl = readHttpsUrl(value.image_url)
  const jumpUrl = readHttpsUrl(value.jump_url)

  if (!title || !text || !imageUrl || !jumpUrl) return null

  return { title, text, imageUrl, jumpUrl }
}

export function parseHomeAdResponse(value: unknown): HomeAd | null {
  if (!isRecord(value) || value.code !== 0 || !Array.isArray(value.data)) return null

  for (const item of value.data) {
    const ad = parseHomeAd(item)
    if (ad) return ad
  }

  return null
}

export async function fetchHomeAd(): Promise<HomeAd | null> {
  const response = await fetchJsonWithTimeout(AD_API_URL, {
    timeoutMs: 10_000,
    maxBytes: 256 * 1024
  })
  return parseHomeAdResponse(response)
}
