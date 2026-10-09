import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { PageHeader } from '../../components/common/PageHeader'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { WarningBox } from '../../components/ui/WarningBox'
import { useNavigate } from '../../provider/Router'
import {
  detectPrivateKeyImport,
  type PrivateKeyImportChainFamily
} from '@/core/keyring/application/private-key-import-detection'
import {
  resolveNearFeatureRuntimePolicy,
  resolveSolanaFeatureRuntimePolicy
} from '@/core/chains/feature-runtime-policy'
import {
  parsePrivateKeyPreview,
  type PrivateKeyAddressPreview
} from '@/popup/services/private-key-preview'

const FAMILY_PRESENTATION = Object.freeze({
  eip155: {
    label: 'EVM',
    description: 'Ethereum and compatible networks',
    icon: 'token-branded:ethereum',
    defaultName: 'Imported EVM Wallet'
  },
  bip122: {
    label: 'Bitcoin',
    description: 'Current Bitcoin network mode',
    icon: 'token-branded:bitcoin',
    defaultName: 'Imported Bitcoin Wallet'
  },
  solana: {
    label: 'Solana',
    description: 'Solana Devnet in Testnet Mode',
    icon: 'token-branded:solana',
    defaultName: 'Imported Solana Wallet'
  },
  near: {
    label: 'NEAR',
    description: 'NEAR Testnet in Testnet Mode',
    icon: 'token-branded:near',
    defaultName: 'Imported NEAR Wallet'
  }
} satisfies Record<PrivateKeyImportChainFamily, Record<string, string>>)

const AVAILABLE_FAMILIES = Object.freeze([
  'eip155',
  'bip122',
  ...(resolveSolanaFeatureRuntimePolicy(__ENABLED_CHAIN_FEATURE_FLAGS__).newOperationsEnabled
    ? (['solana'] as const)
    : []),
  ...(resolveNearFeatureRuntimePolicy(__ENABLED_CHAIN_FEATURE_FLAGS__).newOperationsEnabled
    ? (['near'] as const)
    : [])
] satisfies readonly PrivateKeyImportChainFamily[])
const AVAILABLE_FAMILY_SET = new Set<PrivateKeyImportChainFamily>(AVAILABLE_FAMILIES)
const ED25519_IMPORT_ENABLED = AVAILABLE_FAMILIES.some(
  family => family === 'solana' || family === 'near'
)
const PRIVATE_KEY_PLACEHOLDER = ED25519_IMPORT_ENABLED
  ? `Paste an ${AVAILABLE_FAMILIES.map(family => FAMILY_PRESENTATION[family].label).join(', ')} key`
  : 'Paste EVM hex or Bitcoin WIF'
const PRIVATE_KEY_PROMPT = ED25519_IMPORT_ENABLED
  ? `Enter a supported ${AVAILABLE_FAMILIES.map(family => FAMILY_PRESENTATION[family].label).join(', ')} private key. `
  : 'Enter a supported EVM or Bitcoin private key. '

export function ImportPrivateKey() {
  const { replace } = useNavigate()
  const [privateKey, setPrivateKey] = useState('')
  const [displayName, setDisplayName] = useState('Imported EVM Wallet')
  const [nameEdited, setNameEdited] = useState(false)
  const [familyOverride, setFamilyOverride] = useState<PrivateKeyImportChainFamily | null>(null)
  const [showFamilyPicker, setShowFamilyPicker] = useState(false)
  const [visible, setVisible] = useState(false)
  const [preview, setPreview] = useState<PrivateKeyAddressPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const detection = useMemo(() => {
    const detected = detectPrivateKeyImport(privateKey)
    return detected && AVAILABLE_FAMILY_SET.has(detected.chainFamily) ? detected : null
  }, [privateKey])
  const chainFamily = familyOverride ?? detection?.chainFamily ?? null
  const presentation = chainFamily ? FAMILY_PRESENTATION[chainFamily] : null

  useEffect(() => {
    if (!nameEdited && presentation) setDisplayName(presentation.defaultName)
  }, [nameEdited, presentation])

  const chooseFamily = (family: PrivateKeyImportChainFamily) => {
    setFamilyOverride(family)
    setPreview(null)
    setShowFamilyPicker(false)
    setError(null)
  }

  const previewKey = async () => {
    if (!chainFamily) return
    setPreviewing(true)
    setError(null)
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: 'PREVIEW_PRIVATE_KEY_WALLET',
        privateKey: privateKey.trim(),
        chainFamily
      })
      if (
        typeof response !== 'object' ||
        response === null ||
        Array.isArray(response) ||
        (response as { success?: unknown }).success !== true
      ) {
        throw new Error(
          typeof response === 'object' &&
            response !== null &&
            !Array.isArray(response) &&
            typeof (response as { error?: unknown }).error === 'string'
            ? (response as { error: string }).error
            : 'Private-key preview failed'
        )
      }
      const nextPreview = parsePrivateKeyPreview((response as { result?: unknown }).result)
      if (nextPreview.chainFamily !== chainFamily) {
        throw new Error('Private-key preview does not match the selected network')
      }
      setPreview(nextPreview)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Private-key preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  const submit = async () => {
    if (!chainFamily) return
    setSubmitting(true)
    setError(null)
    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: 'IMPORT_PRIVATE_KEY_WALLET',
        privateKey: privateKey.trim(),
        chainFamily,
        displayName: displayName.trim()
      })
      if (
        typeof response !== 'object' ||
        response === null ||
        Array.isArray(response) ||
        (response as { success?: unknown }).success !== true
      ) {
        throw new Error(
          typeof response === 'object' &&
            response !== null &&
            !Array.isArray(response) &&
            typeof (response as { error?: unknown }).error === 'string'
            ? (response as { error: string }).error
            : 'Private-key Wallet import failed'
        )
      }
      setPrivateKey('')
      replace('/')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Private-key Wallet import failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-container">
      <PageHeader title="Import private key" showBack />
      <div className="page-content space-y-5">
        <div>
          <label htmlFor="private-key-wallet-name" className="mb-2 block text-sm text-muted">
            Wallet name
          </label>
          <Input
            id="private-key-wallet-name"
            value={displayName}
            maxLength={128}
            onChange={event => {
              setDisplayName(event.target.value)
              setNameEdited(true)
            }}
            className="h-[46px] rounded-xl"
          />
        </div>

        <div>
          <label htmlFor="private-key-value" className="mb-2 block text-sm text-muted">
            Private key
          </label>
          <Input
            id="private-key-value"
            type={visible ? 'text' : 'password'}
            value={privateKey}
            maxLength={512}
            spellCheck={false}
            autoComplete="off"
            onChange={event => {
              setPrivateKey(event.target.value)
              setFamilyOverride(null)
              setShowFamilyPicker(false)
              setPreview(null)
              setError(null)
            }}
            placeholder={PRIVATE_KEY_PLACEHOLDER}
            className="h-[46px] rounded-xl font-mono text-xs"
            endContent={
              <button
                type="button"
                aria-label={visible ? 'Hide private key' : 'Show private key'}
                onClick={() => setVisible(value => !value)}
                className="text-muted"
              >
                <Icon icon={visible ? 'lucide:eye-off' : 'lucide:eye'} width={18} height={18} />
              </button>
            }
          />
        </div>

        {privateKey.trim() && !preview && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5">
                <Icon icon={presentation?.icon ?? 'lucide:circle-help'} width={24} height={24} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted">
                  {detection && !familyOverride ? 'Detected network' : 'Import as'}
                </p>
                <p className="font-medium">{presentation?.label ?? 'Network not detected'}</p>
                <p className="truncate text-xs text-muted">
                  {presentation?.description ?? 'Choose the network this key came from'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFamilyPicker(value => !value)}
                className="text-sm font-medium text-primary"
              >
                Change
              </button>
            </div>
            {detection?.ambiguous && !familyOverride && (
              <p className="mt-3 text-xs leading-4 text-muted">
                A 32-byte hex key can be used by multiple networks. Noir Wallet defaults it to EVM.
              </p>
            )}
            {showFamilyPicker && (
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
                {AVAILABLE_FAMILIES.map(family => (
                  <button
                    key={family}
                    type="button"
                    onClick={() => chooseFamily(family)}
                    className={`rounded-xl border px-3 py-2.5 text-sm ${
                      chainFamily === family
                        ? 'border-primary/70 bg-primary/10'
                        : 'border-border bg-background'
                    }`}
                  >
                    {FAMILY_PRESENTATION[family].label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {preview && (
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted">{presentation?.label} address preview</p>
              <button
                type="button"
                onClick={() => {
                  setPreview(null)
                  setShowFamilyPicker(true)
                }}
                className="text-sm font-medium text-primary"
              >
                Change
              </button>
            </div>
            <p className="mt-2 break-all font-mono text-sm leading-5">
              {
                (
                  preview.addresses.find(address => address.preferredForReceive) ??
                  preview.addresses[0]
                ).address
              }
            </p>
            <p className="mt-2 text-xs text-muted">
              {preview.chainFamily === 'eip155'
                ? `Available on ${preview.addresses.length} EVM networks`
                : preview.chainFamily === 'bip122'
                  ? `Native SegWit · ${preview.addresses.length - 1} additional Bitcoin address formats`
                  : `Available on the active ${presentation?.label} network`}
            </p>
          </div>
        )}

        <WarningBox>
          {presentation
            ? `This key will be imported as ${presentation.label}. `
            : PRIVATE_KEY_PROMPT}
          It will not create a Zcash account. Anyone with the key can move its funds.
        </WarningBox>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
      <div className="page-footer">
        <Button
          className="h-[45px] w-full"
          disabled={
            !privateKey.trim() || !displayName.trim() || !chainFamily || previewing || submitting
          }
          isLoading={previewing || submitting}
          onClick={preview ? submit : previewKey}
        >
          {preview ? 'Import wallet' : 'Continue'}
        </Button>
      </div>
    </div>
  )
}
