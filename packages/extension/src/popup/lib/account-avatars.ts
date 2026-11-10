const ACCOUNT_AVATAR_COUNT = 43
const ACCOUNT_AVATAR_BASE_URL = 'https://assets.zknoir.com/images'

export function getAccountAvatarSrc(walletId: string | null, accountId: string | null) {
  if (!walletId || !accountId) return null

  // Keep the choice stable across pages, sorting, and popup lifetimes without persisting it.
  const identity = JSON.stringify([walletId, accountId])
  let hash = 2166136261
  for (let index = 0; index < identity.length; index += 1) {
    hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619)
  }
  return `${ACCOUNT_AVATAR_BASE_URL}/avatar_${((hash >>> 0) % ACCOUNT_AVATAR_COUNT) + 1}.webp`
}
