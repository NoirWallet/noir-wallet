export interface OutboundClickMetadata {
  link_domain: string
  link_id: string
}

/** Reduces an outbound target to a domain and a bounded, declarative identifier. */
export function buildOutboundClickMetadata(
  linkId: string | undefined,
  destination: string | undefined
): OutboundClickMetadata | null {
  if (!destination) return null

  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(destination)
    const url = new URL(hasScheme ? destination : `https://${destination}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const normalizedId = linkId && /^[a-z0-9_]{1,64}$/.test(linkId) ? linkId : 'external_link'
    return { link_domain: url.hostname, link_id: normalizedId }
  } catch {
    return null
  }
}
