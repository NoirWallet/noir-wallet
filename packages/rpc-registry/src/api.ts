import { RPC_REGISTRY, ZCASH_RPC_REGISTRY } from './registry'

const REGISTRY_PATH = '/v1/rpc-endpoints'

export function handleRegistryRequest(request: Request): Response {
  const url = new URL(request.url)
  if (request.method === 'OPTIONS' && url.pathname === REGISTRY_PATH) {
    return new Response(null, {
      status: 204,
      headers: registryHeaders()
    })
  }
  if (request.method !== 'GET' || url.pathname !== REGISTRY_PATH) {
    return new Response('Not Found', { status: 404 })
  }

  const registry =
    url.searchParams.get('scope') === 'multichain' ? RPC_REGISTRY : ZCASH_RPC_REGISTRY
  return Response.json(registry, { headers: registryHeaders() })
}

function registryHeaders(): HeadersInit {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    'cloudflare-cdn-cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff'
  }
}
