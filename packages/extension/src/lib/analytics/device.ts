export interface AnalyticsDeviceMetadata {
  browser: string
  device_category: 'desktop'
  language: string
  operating_system: string
}

function detectBrowser(userAgent: string): string {
  if (/Edg\//.test(userAgent)) return 'Edge'
  if (/OPR\//.test(userAgent)) return 'Opera'
  if (/Firefox\//.test(userAgent)) return 'Firefox'
  if (/Chrome\//.test(userAgent)) return 'Chrome'
  if (/Safari\//.test(userAgent)) return 'Safari'
  return 'Other'
}

function detectOperatingSystem(userAgent: string): string {
  if (/CrOS\b/.test(userAgent)) return 'Chrome OS'
  if (/Windows\b/.test(userAgent)) return 'Windows'
  if (/Android\b/.test(userAgent)) return 'Android'
  if (/(?:iPhone|iPad|iPod)\b/.test(userAgent)) return 'iOS'
  if (/(?:Macintosh|Mac OS X)\b/.test(userAgent)) return 'macOS'
  if (/Linux\b/.test(userAgent)) return 'Linux'
  return 'Other'
}

function normalizeLanguage(language: string): string {
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(language)) return 'und'
  try {
    return Intl.getCanonicalLocales(language)[0] ?? 'und'
  } catch {
    return 'und'
  }
}

/** Returns deliberately coarse device data suitable for both analytics channels. */
export function getAnalyticsDeviceMetadata(
  source: Pick<Navigator, 'language' | 'userAgent'> = navigator
): AnalyticsDeviceMetadata {
  return {
    browser: detectBrowser(source.userAgent),
    device_category: 'desktop',
    language: normalizeLanguage(source.language),
    operating_system: detectOperatingSystem(source.userAgent)
  }
}
