import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import type { AddressType } from '@/types'
import {
  fetchSwapTokens,
  fetchDryQuote,
  getZecToken,
  getDefaultToToken,
  isZecToken,
  getCachedTokens,
  type SwapToken
} from '@/core/services/intents-api'
import { usePolling } from './useRequest'
import { safeBig } from '@/lib/big'
import { parseAmount } from '@/lib/format'
import { useSwapPreferences } from '@/store/swap-store'

const PRICE_SYNC_INTERVAL = 15 * 1000

export interface SwapState {
  tokenIn: SwapToken | null
  tokenOut: SwapToken | null
  amountIn: string
  amountOut: string
  recipientAddress: string
  refundAddress: string
  depositAddress: string
  addressType: AddressType
  slippage: number
  isQuoting: boolean
  quoteError: string | null
  areTokensLoading: boolean
}

export function useSwapState(referral: string) {
  const swapPrefs = useSwapPreferences()

  const [tokenIn, setTokenIn] = useState<SwapToken | null>(null)
  const [tokenOut, setTokenOut] = useState<SwapToken | null>(null)
  const [amountIn, setAmountIn] = useState('')
  const [amountOut, setAmountOut] = useState('')
  const [recipientAddress, setRecipientAddress] = useState('')
  const [refundAddress, setRefundAddress] = useState('')
  const [depositAddress, setDepositAddress] = useState('')
  const [isQuoting, setIsQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  const {
    addressType,
    slippage,
    setAddressType,
    setSlippage,
    savedTokenInId,
    savedTokenOutId,
    setSavedTokenInId,
    setSavedTokenOutId
  } = swapPrefs

  const [areTokensLoading, setAreTokensLoading] = useState(true)
  const [dryQuoteOut, setDryQuoteOut] = useState('')
  const dryQuoteTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const dryQuoteAbort = useRef<AbortController>(undefined)

  // Initialize tokens on mount
  useEffect(() => {
    async function init() {
      try {
        const tokens = await fetchSwapTokens()

        // Find saved or default tokens
        let defaultIn = tokens.find(t => t.assetId === savedTokenInId)
        let defaultOut = tokens.find(t => t.assetId === savedTokenOutId)

        if (!defaultIn) {
          defaultIn = getZecToken(tokens) || undefined
        }

        if (!defaultOut) {
          defaultOut = getDefaultToToken(tokens) || undefined
        }

        if (defaultIn) {
          setTokenIn(defaultIn)
          setSavedTokenInId(defaultIn.assetId)
        }
        if (defaultOut) {
          setTokenOut(defaultOut)
          setSavedTokenOutId(defaultOut.assetId)
        }
      } finally {
        setAreTokensLoading(false)
      }
    }
    init()
  }, [])

  // Refresh prices for the selected pair by re-pulling the full 1Click list
  const bothSelected = !!tokenIn && !!tokenOut

  usePolling(
    async () => {
      const updated = await fetchSwapTokens(true)
      const tokenMap = new Map(updated.map(t => [t.assetId, t]))

      setTokenIn(prev => {
        if (prev && tokenMap.has(prev.assetId)) {
          return tokenMap.get(prev.assetId)!
        }
        return prev
      })

      setTokenOut(prev => {
        if (prev && tokenMap.has(prev.assetId)) {
          return tokenMap.get(prev.assetId)!
        }
        return prev
      })

      return updated
    },
    PRICE_SYNC_INTERVAL,
    { manual: !bothSelected }
  )

  useEffect(() => {
    if (dryQuoteTimer.current) clearTimeout(dryQuoteTimer.current)
    dryQuoteAbort.current?.abort()
    setDryQuoteOut('')

    if (!tokenIn || !tokenOut || !amountIn || safeBig(amountIn).lte(0)) return

    dryQuoteTimer.current = setTimeout(async () => {
      const abort = new AbortController()
      dryQuoteAbort.current = abort

      try {
        const amount = parseAmount(amountIn, tokenIn.decimals)
        const result = await fetchDryQuote({
          tokenIn,
          tokenOut,
          amount,
          slippageTolerance: Math.round(slippage * 100),
          referral
        })

        if (!abort.signal.aborted && result) {
          setDryQuoteOut(result)
        }
      } catch {
        // ignore
      }
    }, 600)

    return () => {
      if (dryQuoteTimer.current) clearTimeout(dryQuoteTimer.current)
      dryQuoteAbort.current?.abort()
    }
  }, [amountIn, tokenIn?.assetId, tokenOut?.assetId, slippage, referral])

  // Derived state
  const isZecToOther = isZecToken(tokenIn)

  const estimatedOut = useMemo(() => {
    if (dryQuoteOut) return dryQuoteOut
    if (!amountIn || !tokenIn?.price || !tokenOut?.price) return ''
    const inAmount = safeBig(amountIn).toNumber()
    if (isNaN(inAmount) || inAmount <= 0) return ''
    return ((inAmount * tokenIn.price) / tokenOut.price).toFixed(6)
  }, [amountIn, tokenIn?.price, tokenOut?.price, dryQuoteOut])

  const rate = useMemo(() => {
    if (!tokenIn?.price || !tokenOut?.price) return '...'
    return safeBig(tokenIn.price).div(tokenOut.price).toFixed()
  }, [tokenIn?.price, tokenOut?.price])

  const displayOut = amountOut || estimatedOut
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

  const canGetQuote =
    !!tokenIn &&
    !!tokenOut &&
    !!amountIn &&
    safeBig(amountIn).gt(0) &&
    (isZecToOther ? !!recipientAddress : !!refundAddress)

  // Actions
  const switchTokens = useCallback(() => {
    const temp = tokenIn
    setTokenIn(tokenOut)
    if (tokenOut) setSavedTokenInId(tokenOut.assetId)

    setTokenOut(temp)
    if (temp) setSavedTokenOutId(temp.assetId)

    setAmountIn('')
    setAmountOut('')
    setDryQuoteOut('')
    setQuoteError(null)
  }, [tokenIn, tokenOut, setSavedTokenInId, setSavedTokenOutId])

  const resetSwap = useCallback(() => {
    const cached = getCachedTokens()
    const zec = getZecToken(cached)
    if (zec) {
      setTokenIn(zec)
      setSavedTokenInId(zec.assetId)
    }

    const defaultOut = getDefaultToToken(cached)
    setTokenOut(defaultOut)
    if (defaultOut) {
      setSavedTokenOutId(defaultOut.assetId)
    }

    setAmountIn('')
    setAmountOut('')
    setRecipientAddress('')
    setRefundAddress('')
    setDepositAddress('')
    setQuoteError(null)
  }, [setSavedTokenInId, setSavedTokenOutId])

  const selectTokenIn = useCallback(
    (token: SwapToken) => {
      setTokenIn(token)
      setSavedTokenInId(token.assetId)

      if (!isZecToken(token)) {
        const cached = getCachedTokens()
        const zec = getZecToken(cached)
        if (zec) {
          setTokenOut(zec)
          setSavedTokenOutId(zec.assetId)
        }
      }
      setAmountOut('')
      setQuoteError(null)
    },
    [setSavedTokenInId, setSavedTokenOutId]
  )

  const selectTokenOut = useCallback(
    (token: SwapToken) => {
      setTokenOut(token)
      setSavedTokenOutId(token.assetId)
      setAmountOut('')
      setQuoteError(null)
    },
    [setSavedTokenOutId]
  )

  const updateAmountIn = useCallback((value: string) => {
    setAmountIn(value.replace(/[^0-9.]/g, ''))
    setAmountOut('')
    setDryQuoteOut('')
    setQuoteError(null)
  }, [])

  return {
    // State
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    recipientAddress,
    refundAddress,
    depositAddress,
    addressType,
    slippage,
    isQuoting,
    quoteError,
    areTokensLoading,

    // Derived
    isZecToOther,
    estimatedOut,
    rate,
    displayOut,
    fromFiat,
    toFiat,
    canGetQuote,

    // Setters
    setAmountOut,
    setRecipientAddress,
    setRefundAddress,
    setDepositAddress,
    setAddressType,
    setSlippage,
    setIsQuoting,
    setQuoteError,

    // Actions
    switchTokens,
    resetSwap,
    selectTokenIn,
    selectTokenOut,
    updateAmountIn
  }
}
