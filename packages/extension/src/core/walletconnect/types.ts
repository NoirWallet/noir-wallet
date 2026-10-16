export interface WalletConnectSessionSummary {
  topic: string
  name: string
  url: string
  accountLabel: string
}

export interface WalletConnectProposalSummary {
  id: number
  name: string
  url: string
  verification: 'VALID' | 'UNKNOWN'
  methods: string[]
}

export interface WalletConnectState {
  enabled: boolean
  accountLabel: string | null
  accountAvailable: boolean
  sessions: WalletConnectSessionSummary[]
  proposals: WalletConnectProposalSummary[]
}
