import { create } from 'zustand'
import { accountManager } from '@/core/wallet/account-manager'
import { MnemonicGenerator } from '@/core/wallet/mnemonic'
import { WALLET_CONFIG } from '@/config/wallet'
import { ANALYTICS_EVENTS, sendAnalyticsEvent } from '@/lib/analytics'
import { DedupPromise, LatestAttempt } from '@/lib/async-utils'
import { classifyError } from '@/lib/errors'

export type FlowMode = 'onboarding' | 'addWallet'

export interface OnboardingState {
  flowMode: FlowMode
  mode: 'create' | 'import'
  password: string
  confirmPassword: string
  seedPhrase: string[]
  importedSeedPhrase: string
  birthdayHeight?: number
  agreedToTerms: boolean
  acknowledgedWarning: boolean
  selectedWords: string[]
  selectedWordIndices: number[]
  verificationIndices: number[]
  isLoading: boolean
  error: string | null
  dappRequestId: string | null // Store dApp request ID if onboarding triggered by dApp

  // Actions
  setFlowMode: (mode: FlowMode) => void
  setMode: (mode: 'create' | 'import') => void
  setPassword: (password: string) => void
  setConfirmPassword: (password: string) => void
  setSeedPhrase: (phrase: string[]) => void
  setImportedSeedPhrase: (phrase: string) => void
  setBirthdayHeight: (height?: number) => void
  setAgreedToTerms: (agreed: boolean) => void
  setAcknowledgedWarning: (acknowledged: boolean) => void
  setDappRequestId: (requestId: string | null) => void
  selectWord: (index: number) => void
  generateSeedPhrase: () => Promise<void>
  verifySeedPhrase: () => boolean
  createWallet: () => Promise<boolean>
  importWallet: () => Promise<boolean>
  reset: () => void
  validatePassword: () => boolean
  addWallet: () => Promise<boolean>
  addImportedWallet: () => Promise<boolean>
}

const importAttempts = new LatestAttempt()
const generationAttempts = new LatestAttempt()
let generationDedup = new DedupPromise<void>()

function invalidateGeneration() {
  generationAttempts.invalidate()
  // A cancelled flow must not share the previous flow's pending generation.
  generationDedup = new DedupPromise<void>()
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  flowMode: 'onboarding',
  mode: 'create',
  password: '',
  confirmPassword: '',
  seedPhrase: [],
  importedSeedPhrase: '',
  birthdayHeight: undefined,
  agreedToTerms: false,
  acknowledgedWarning: false,
  selectedWords: [],
  selectedWordIndices: [],
  verificationIndices: [],
  isLoading: false,
  error: null,
  dappRequestId: null,

  setFlowMode: flowMode => set({ flowMode }),
  setMode: mode => set({ mode }),
  setPassword: password => set({ password, error: null }),
  setConfirmPassword: confirmPassword => set({ confirmPassword, error: null }),
  setSeedPhrase: seedPhrase => {
    invalidateGeneration()
    set({
      seedPhrase,
      selectedWords: [],
      selectedWordIndices: [],
      verificationIndices: [],
      acknowledgedWarning: false,
      isLoading: false,
      error: null
    })
  },
  setImportedSeedPhrase: importedSeedPhrase => {
    importAttempts.invalidate()
    set({
      importedSeedPhrase,
      error: null,
      isLoading: false
    })
  },
  setBirthdayHeight: birthdayHeight => set({ birthdayHeight }),
  setAgreedToTerms: agreedToTerms => set({ agreedToTerms, error: null }),
  setAcknowledgedWarning: acknowledgedWarning => set({ acknowledgedWarning }),
  setDappRequestId: dappRequestId => set({ dappRequestId }),

  selectWord: index =>
    set(state => {
      if (
        state.isLoading ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= state.seedPhrase.length
      ) {
        return state
      }
      const selectedWordIndices = state.selectedWordIndices.includes(index)
        ? state.selectedWordIndices.filter(selectedIndex => selectedIndex !== index)
        : [...state.selectedWordIndices, index].slice(0, 2)
      return {
        selectedWordIndices,
        selectedWords: selectedWordIndices.map(selectedIndex => state.seedPhrase[selectedIndex]),
        error: null
      }
    }),

  generateSeedPhrase: () =>
    generationDedup.run(async () => {
      const attemptId = generationAttempts.begin()
      set({ isLoading: true, error: null })
      try {
        const words = await MnemonicGenerator.generateSecurePhrase()
        if (!generationAttempts.isCurrent(attemptId)) return
        if (
          !Array.isArray(words) ||
          words.length !== WALLET_CONFIG.MNEMONIC_LENGTH ||
          !Array.from(words).every(word => typeof word === 'string' && /^\S+$/.test(word))
        ) {
          throw new Error('Failed to generate seed phrase')
        }
        const random = crypto.getRandomValues(new Uint32Array(2))
        const first = random[0] % words.length
        const second = random[1] % (words.length - 1)
        const indices = [first, second >= first ? second + 1 : second].sort((a, b) => a - b)
        set({
          seedPhrase: words,
          verificationIndices: indices,
          selectedWords: [],
          selectedWordIndices: [],
          acknowledgedWarning: false,
          isLoading: false
        })
      } catch (err) {
        if (!generationAttempts.isCurrent(attemptId)) return
        set({ isLoading: false, error: classifyError(err).userMessage })
      }
    }),

  verifySeedPhrase: () => {
    const { verificationIndices, seedPhrase, selectedWords } = get()
    const isCorrect =
      verificationIndices.length === 2 &&
      verificationIndices[0] !== verificationIndices[1] &&
      Number.isInteger(verificationIndices[0]) &&
      Number.isInteger(verificationIndices[1]) &&
      verificationIndices[0] >= 0 &&
      verificationIndices[1] >= 0 &&
      verificationIndices[0] < seedPhrase.length &&
      verificationIndices[1] < seedPhrase.length &&
      selectedWords.length === 2 &&
      typeof selectedWords[0] === 'string' &&
      typeof selectedWords[1] === 'string' &&
      Boolean(selectedWords[0]) &&
      Boolean(selectedWords[1]) &&
      selectedWords[0] === seedPhrase[verificationIndices[0]] &&
      selectedWords[1] === seedPhrase[verificationIndices[1]]
    if (!isCorrect) {
      set({ error: 'Selected words do not match. Please try again.' })
      return false
    }
    set({ error: null })
    return true
  },

  createWallet: async () => {
    if (get().isLoading || !get().verifySeedPhrase()) return false
    set({ isLoading: true, error: null })
    try {
      const { seedPhrase, password } = get()
      await accountManager.importWallet(seedPhrase.join(' '), password, 'Account 1')

      chrome.runtime.sendMessage({ type: 'WALLET_CREATED' }).catch(console.error)
      sendAnalyticsEvent(ANALYTICS_EVENTS.WALLET_CREATED, { params: { method: 'create' } })

      set({ isLoading: false })
      return true
    } catch (err) {
      const { userMessage } = classifyError(err)
      set({ isLoading: false, error: userMessage })
      return false
    }
  },

  importWallet: async () => {
    const importAttemptId = importAttempts.begin()
    set({ isLoading: true, error: null })
    try {
      const { importedSeedPhrase, password, birthdayHeight } = get()
      await accountManager.importWallet(
        importedSeedPhrase,
        password,
        'Imported Account',
        birthdayHeight
      )

      if (!importAttempts.isCurrent(importAttemptId)) {
        return false
      }

      chrome.runtime.sendMessage({ type: 'WALLET_CREATED' }).catch(console.error)
      sendAnalyticsEvent(ANALYTICS_EVENTS.WALLET_CREATED, {
        params: { method: 'import' },
        extra: { has_birthday_height: get().birthdayHeight !== undefined }
      })

      set({ isLoading: false })
      return true
    } catch (err) {
      if (!importAttempts.isCurrent(importAttemptId)) {
        return false
      }
      const { userMessage } = classifyError(err)
      set({ isLoading: false, error: userMessage })
      return false
    }
  },

  validatePassword: () => {
    const { password, confirmPassword, agreedToTerms } = get()
    if (password.length < WALLET_CONFIG.SECURITY.MIN_PASSWORD_LENGTH) {
      set({
        error: `Password must be at least ${WALLET_CONFIG.SECURITY.MIN_PASSWORD_LENGTH} characters`
      })
      return false
    }
    if (password !== confirmPassword) {
      set({ error: 'Passwords do not match' })
      return false
    }
    if (!agreedToTerms) {
      set({ error: 'Please agree to the Terms of Use' })
      return false
    }
    return true
  },

  reset: () => {
    // Preserve dappRequestId when resetting - it's set before onboarding and needed after
    const currentDappRequestId = get().dappRequestId
    importAttempts.invalidate()
    invalidateGeneration()
    set({
      flowMode: 'onboarding',
      mode: 'create',
      password: '',
      confirmPassword: '',
      seedPhrase: [],
      importedSeedPhrase: '',
      birthdayHeight: undefined,
      agreedToTerms: false,
      acknowledgedWarning: false,
      selectedWords: [],
      selectedWordIndices: [],
      verificationIndices: [],
      isLoading: false,
      error: null,
      dappRequestId: currentDappRequestId // Keep dappRequestId
    })
  },

  addWallet: async () => {
    if (get().isLoading || !get().verifySeedPhrase()) return false
    set({ isLoading: true, error: null })
    try {
      const { seedPhrase } = get()
      await accountManager.addNewWallet(seedPhrase.join(' '))

      chrome.runtime.sendMessage({ type: 'WALLET_CREATED' }).catch(console.error)
      sendAnalyticsEvent(ANALYTICS_EVENTS.WALLET_CREATED, { params: { method: 'create' } })

      set({ isLoading: false })
      return true
    } catch (err) {
      const { userMessage } = classifyError(err)
      set({ isLoading: false, error: userMessage })
      return false
    }
  },

  addImportedWallet: async () => {
    const importAttemptId = importAttempts.begin()
    set({ isLoading: true, error: null })
    try {
      const { importedSeedPhrase, birthdayHeight } = get()
      await accountManager.addImportedWallet(importedSeedPhrase, undefined, birthdayHeight)

      if (!importAttempts.isCurrent(importAttemptId)) {
        return false
      }

      chrome.runtime.sendMessage({ type: 'WALLET_CREATED' }).catch(console.error)
      sendAnalyticsEvent(ANALYTICS_EVENTS.WALLET_CREATED, {
        params: { method: 'import' },
        extra: { has_birthday_height: birthdayHeight !== undefined }
      })

      set({ isLoading: false })
      return true
    } catch (err) {
      if (!importAttempts.isCurrent(importAttemptId)) {
        return false
      }
      const { userMessage } = classifyError(err)
      set({ isLoading: false, error: userMessage })
      return false
    }
  }
}))
