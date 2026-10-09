import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { isZecToken } from '@/core/services/intents-api'
import { type RheaSwapToken } from '@/core/services/rhea-swap'
import { safeBig } from '@/lib/big'
import { useSwapPreferences } from '@/store/swap-store'
import {
  WALLET_SOURCE_CHAIN_IDS,
  ALL_DESTINATION_CHAIN_IDS,
  mergeTokenCatalogs,
  readCachedTokenCatalogByChain,
  loadTokenCatalogByChain,
  buildInitialSwapCatalogPlan,
  findSwapTokenInCatalog,
  type SwapInitialCatalogOptions
} from '@/popup/services/swap-catalog-loading'
import { estimateSwapOutputFromPrices } from '@/popup/components/swap/swap-estimate'
import { getSwapDestinationTokens } from '@/popup/services/swap-token-selection'

export function useSwapState(
  preferenceScope: string | null,
  options: SwapInitialCatalogOptions = {}
) {
  const [initialSelection] = useState(() =>
    preferenceScope ? useSwapPreferences.getState().tokenSelections[preferenceScope] : undefined
  )
  const [initialCatalogs] = useState(() => ({
    sources: readCachedTokenCatalogByChain('from', WALLET_SOURCE_CHAIN_IDS),
    destinations: readCachedTokenCatalogByChain('cross-chain-to', ALL_DESTINATION_CHAIN_IDS)
  }))

  const [tokenIn, setTokenIn] = useState<RheaSwapToken | null>(
    initialCatalogs.sources?.find(token => token.assetId === initialSelection?.tokenInId) ?? null
  )
  const [tokenOut, setTokenOut] = useState<RheaSwapToken | null>(
    initialCatalogs.destinations?.find(token => token.assetId === initialSelection?.tokenOutId) ??
      initialCatalogs.sources?.find(token => token.assetId === initialSelection?.tokenOutId) ??
      null
  )
  const [sourceCatalog, setSourceCatalog] = useState<readonly RheaSwapToken[]>(
    initialCatalogs.sources ?? []
  )
  const [crossChainDestinationCatalog, setCrossChainDestinationCatalog] = useState<
    readonly RheaSwapToken[]
  >(initialCatalogs.destinations ?? [])
  const selectorSourceCatalog = useRef<readonly RheaSwapToken[]>([])
  const [amountIn, setAmountIn] = useState('')
  const [amountOut, setAmountOut] = useState('')
  const [recipientAddress, setRecipientAddress] = useState('')
  const [depositAddress, setDepositAddress] = useState('')
  const [isQuoting, setIsQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [catalogError, setCatalogError] = useState(false)
  const [catalogRequestId, setCatalogRequestId] = useState(0)

  const addressType = useSwapPreferences(state => state.addressType)
  const slippage = useSwapPreferences(state => state.slippage)
  const setAddressType = useSwapPreferences(state => state.setAddressType)
  const setSlippage = useSwapPreferences(state => state.setSlippage)
  const setSavedTokenSelection = useSwapPreferences(state => state.setSavedTokenSelection)
  const setSavedTokenInId = useSwapPreferences(state => state.setSavedTokenInId)
  const setSavedTokenOutId = useSwapPreferences(state => state.setSavedTokenOutId)

  const [areTokensLoading, setAreTokensLoading] = useState(true)
  const [destinationTokensLoading, setDestinationTokensLoading] = useState(true)

  const activePreferenceScope = useRef(preferenceScope)
  useEffect(() => {
    if (activePreferenceScope.current === preferenceScope) return
    activePreferenceScope.current = preferenceScope
    setTokenIn(null)
    setTokenOut(null)
    setAmountIn('')
    setAmountOut('')
    setRecipientAddress('')
    setDepositAddress('')
    setQuoteError(null)
  }, [preferenceScope])

  useEffect(() => {
    let cancelled = false
    const readActiveSelection = () => {
      const scope = activePreferenceScope.current
      return scope ? useSwapPreferences.getState().tokenSelections[scope] : undefined
    }
    async function init() {
      const selection = readActiveSelection()
      const plan = buildInitialSwapCatalogPlan({
        ...options,
        sourceAssetId: options.sourceAssetId ?? selection?.tokenInId,
        destinationAssetId: options.destinationAssetId ?? selection?.tokenOutId
      })
      const bypassCache = catalogRequestId > 0
      const cachedSources = bypassCache
        ? []
        : readCachedTokenCatalogByChain('from', WALLET_SOURCE_CHAIN_IDS)
      const cachedDestinations = bypassCache
        ? []
        : readCachedTokenCatalogByChain('cross-chain-to', ALL_DESTINATION_CHAIN_IDS)
      setAreTokensLoading(true)
      setDestinationTokensLoading(true)
      setCatalogError(false)
      setSourceCatalog(cachedSources ?? [])
      setCrossChainDestinationCatalog(cachedDestinations ?? [])
      const destinationsRequest = loadTokenCatalogByChain(
        'cross-chain-to',
        plan.destinationChainIds,
        bypassCache,
        tokens => {
          setCrossChainDestinationCatalog(previous => mergeTokenCatalogs(previous, tokens))
          setTokenOut(
            previous =>
              previous ??
              tokens.find(token => token.assetId === readActiveSelection()?.tokenOutId) ??
              null
          )
        },
        () => cancelled
      ).finally(() => {
        if (!cancelled) setDestinationTokensLoading(false)
      })
      try {
        const sources = await loadTokenCatalogByChain(
          'from',
          plan.sourceChainIds,
          bypassCache,
          tokens => {
            setSourceCatalog(previous => mergeTokenCatalogs(previous, tokens))
            setTokenIn(
              previous =>
                previous ??
                tokens.find(token => token.assetId === readActiveSelection()?.tokenInId) ??
                null
            )
          },
          () => cancelled
        )
        if (cancelled) return
        if (sources.length === 0) {
          throw new Error('RHEA Swap source assets are unavailable')
        }
        setSourceCatalog(previous => mergeTokenCatalogs(previous, sources))
        setTokenIn(
          previous =>
            previous ??
            sources.find(token => token.assetId === readActiveSelection()?.tokenInId) ??
            null
        )
        setAreTokensLoading(false)
      } catch {
        if (!cancelled) {
          setSourceCatalog([])
          setCrossChainDestinationCatalog([])
          setTokenIn(null)
          setTokenOut(null)
          setAmountOut('')
          setQuoteError(null)
          setCatalogError(true)
        }
      } finally {
        if (!cancelled) setAreTokensLoading(false)
        await destinationsRequest
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [
    catalogRequestId,
    preferenceScope,
    options.sourceAssetId,
    options.destinationAssetId,
    options.destinationApiChainId,
    options.defaultSourceChainId
  ])

  const loadSelectorTokens = useCallback(
    async (
      direction: 'from' | 'cross-chain-to',
      onTokens: (tokens: readonly RheaSwapToken[]) => void,
      isCancelled: () => boolean
    ) => {
      let loaded = direction === 'from' ? sourceCatalog : crossChainDestinationCatalog
      const publish = (next: readonly RheaSwapToken[]) => {
        loaded = mergeTokenCatalogs(loaded, next)
        if (direction === 'from') {
          selectorSourceCatalog.current = loaded
          if (tokenOut && findSwapTokenInCatalog(next, tokenOut)) {
            setSourceCatalog(previous =>
              findSwapTokenInCatalog(previous, tokenOut)
                ? previous
                : mergeTokenCatalogs(previous, [tokenOut])
            )
          }
        }
        onTokens(
          direction === 'from' ? loaded : getSwapDestinationTokens(tokenIn, sourceCatalog, loaded)
        )
      }
      await loadTokenCatalogByChain(
        direction,
        direction === 'from'
          ? WALLET_SOURCE_CHAIN_IDS
          : ALL_DESTINATION_CHAIN_IDS.filter(chainId => chainId !== tokenIn?.tokenListChainId),
        false,
        publish,
        isCancelled
      )
      return direction === 'from'
        ? loaded
        : getSwapDestinationTokens(tokenIn, sourceCatalog, loaded)
    },
    [sourceCatalog, crossChainDestinationCatalog, tokenIn, tokenOut]
  )

  const destinationTokens = useMemo(
    () => getSwapDestinationTokens(tokenIn, sourceCatalog, crossChainDestinationCatalog),
    [crossChainDestinationCatalog, sourceCatalog, tokenIn]
  )
  useEffect(() => {
    if (!tokenOut || findSwapTokenInCatalog(sourceCatalog, tokenOut)) return
    const sourceToken = findSwapTokenInCatalog(selectorSourceCatalog.current, tokenOut)
    if (!sourceToken) return
    setSourceCatalog(previous => mergeTokenCatalogs(previous, [sourceToken]))
  }, [sourceCatalog, tokenOut])
  const tokens = useMemo(
    () => mergeTokenCatalogs(sourceCatalog, destinationTokens),
    [destinationTokens, sourceCatalog]
  )

  useEffect(() => {
    if (
      tokenOut &&
      !destinationTokens.some(
        token =>
          token.rheaChainId === tokenOut.rheaChainId && token.rheaAddress === tokenOut.rheaAddress
      )
    ) {
      setTokenOut(null)
      setAmountOut('')
      setQuoteError(null)
    }
  }, [destinationTokens, tokenOut])

  // Derived state
  const isZecSource = isZecToken(tokenIn)

  const rate = useMemo(() => {
    if (!amountIn || !amountOut || safeBig(amountIn).lte(0)) return '...'
    return safeBig(amountOut).div(amountIn).toFixed()
  }, [amountIn, amountOut])

  const provisionalAmountOut = useMemo(
    () =>
      estimateSwapOutputFromPrices({
        amountIn,
        tokenInPrice: tokenIn?.price,
        tokenOutPrice: tokenOut?.price
      }),
    [amountIn, tokenIn?.price, tokenOut?.price]
  )
  const displayOut = amountOut || (quoteError ? '' : provisionalAmountOut)
  const isEstimatedOut = amountOut === '' && displayOut !== ''
  const fromFiat = amountIn
    ? safeBig(amountIn)
        .times(tokenIn?.price || 0)
        .toFixed(2)
    : '0.00'
  const toFiat = displayOut
    ? safeBig(displayOut)
        .times(tokenOut?.price || 0)
        .toFixed(2)
    : '0.00'

  // Actions
  const activePair = useRef({ tokenIn, tokenOut })
  activePair.current = { tokenIn, tokenOut }
  useEffect(
    () => () => {
      activePair.current = { tokenIn: null, tokenOut: null }
    },
    []
  )
  const switchTokens = useCallback(async () => {
    if (!tokenIn || !tokenOut) return
    if (tokenIn.rheaChainId !== tokenOut.rheaChainId) {
      const isCancelled = () =>
        activePair.current.tokenIn !== tokenIn || activePair.current.tokenOut !== tokenOut
      const [reverseSources, reverseDestinations] = await Promise.all([
        loadTokenCatalogByChain(
          'from',
          [tokenOut.tokenListChainId],
          false,
          tokens => setSourceCatalog(previous => mergeTokenCatalogs(previous, tokens)),
          isCancelled
        ),
        loadTokenCatalogByChain(
          'cross-chain-to',
          [tokenIn.tokenListChainId],
          false,
          tokens =>
            setCrossChainDestinationCatalog(previous => mergeTokenCatalogs(previous, tokens)),
          isCancelled
        )
      ])
      if (!reverseSources.some(token => token.assetId === tokenOut.assetId)) return
      if (!reverseDestinations.some(token => token.assetId === tokenIn.assetId)) return
      if (activePair.current.tokenIn !== tokenIn || activePair.current.tokenOut !== tokenOut) return
    }
    const temp = tokenIn
    setTokenIn(tokenOut)
    if (preferenceScope && tokenOut) setSavedTokenInId(preferenceScope, tokenOut.assetId)

    setTokenOut(temp)
    if (preferenceScope && temp) setSavedTokenOutId(preferenceScope, temp.assetId)

    setAmountIn('')
    setAmountOut('')
    setQuoteError(null)
  }, [preferenceScope, tokenIn, tokenOut, setSavedTokenInId, setSavedTokenOutId])

  const resetSwap = useCallback(() => {
    setAmountIn('')
    setAmountOut('')
    setRecipientAddress('')
    setDepositAddress('')
    setQuoteError(null)
  }, [])

  const setTokenPair = useCallback(
    (nextTokenIn: RheaSwapToken, nextTokenOut: RheaSwapToken | null) => {
      setTokenIn(nextTokenIn)
      setTokenOut(nextTokenOut)
      if (preferenceScope) {
        setSavedTokenSelection(preferenceScope, {
          tokenInId: nextTokenIn.assetId,
          tokenOutId: nextTokenOut?.assetId ?? null
        })
      }
      setAmountIn('')
      setAmountOut('')
      setQuoteError(null)
    },
    [preferenceScope, setSavedTokenSelection]
  )

  const selectTokenIn = useCallback(
    (token: RheaSwapToken) => {
      setSourceCatalog(previous =>
        findSwapTokenInCatalog(previous, token) ? previous : mergeTokenCatalogs(previous, [token])
      )
      setTokenIn(token)
      if (preferenceScope) setSavedTokenInId(preferenceScope, token.assetId)
      setAmountOut('')
      setQuoteError(null)
    },
    [preferenceScope, setSavedTokenInId]
  )

  const selectTokenOut = useCallback(
    (token: RheaSwapToken) => {
      if (token.blockchain === tokenIn?.blockchain) {
        setSourceCatalog(previous =>
          previous.includes(token) ? previous : mergeTokenCatalogs(previous, [token])
        )
      } else {
        setCrossChainDestinationCatalog(previous =>
          findSwapTokenInCatalog(previous, token) ? previous : mergeTokenCatalogs(previous, [token])
        )
      }
      setTokenOut(token)
      if (preferenceScope) setSavedTokenOutId(preferenceScope, token.assetId)
      setAmountOut('')
      setQuoteError(null)
    },
    [preferenceScope, setSavedTokenOutId, tokenIn?.blockchain]
  )

  const selectTokenOutForFlow = useCallback((token: RheaSwapToken) => {
    setTokenOut(token)
    setAmountOut('')
    setQuoteError(null)
  }, [])

  const clearTokenOutForFlow = useCallback(() => {
    setTokenOut(null)
    setAmountOut('')
    setQuoteError(null)
  }, [])

  const clearTokenPairForFlow = useCallback(() => {
    setTokenIn(null)
    setTokenOut(null)
    setAmountOut('')
    setQuoteError(null)
  }, [])

  const updateAmountIn = useCallback((value: string) => {
    setAmountIn(value.replace(/[^0-9.]/g, ''))
    setAmountOut('')
    setQuoteError(null)
  }, [])

  const retryTokenCatalog = useCallback(() => {
    setCatalogRequestId(value => value + 1)
  }, [])

  return {
    // State
    tokenIn,
    tokenOut,
    tokens,
    sourceTokens: sourceCatalog,
    crossChainDestinationTokens: crossChainDestinationCatalog,
    destinationTokens,
    amountIn,
    amountOut,
    recipientAddress,
    depositAddress,
    addressType,
    slippage,
    isQuoting,
    quoteError,
    catalogError,
    areTokensLoading,
    destinationTokensLoading,

    // Derived
    isZecSource,
    rate,
    displayOut,
    isEstimatedOut,
    fromFiat,
    toFiat,

    // Setters
    setAmountOut,
    setRecipientAddress,
    setDepositAddress,
    setAddressType,
    setSlippage,
    setIsQuoting,
    setQuoteError,

    // Actions
    switchTokens,
    retryTokenCatalog,
    resetSwap,
    setTokenPair,
    selectTokenIn,
    selectTokenOut,
    selectTokenOutForFlow,
    loadSelectorTokens,
    clearTokenOutForFlow,
    clearTokenPairForFlow,
    updateAmountIn
  }
}
