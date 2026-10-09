import { PageHeader } from '../../components/common/PageHeader'
import { Switch } from '@/popup/components/ui/switch'
import { useSettingsStore } from '@/store/settings-store'

export function ExperimentalFeatures() {
  const { enableDerivedAccounts, setEnableDerivedAccounts } = useSettingsStore()

  return (
    <div className="page-container">
      <PageHeader title="Experimental Features" showBack />

      <div className="page-content space-y-4">
        <p className="text-xs text-warning">
          These features are experimental and may have bugs or unexpected behavior.
        </p>

        <button
          type="button"
          role="switch"
          aria-checked={enableDerivedAccounts}
          onClick={() => setEnableDerivedAccounts(!enableDerivedAccounts)}
          className="w-full p-4 bg-card rounded-xl border border-white/10 hover:bg-white/5 cursor-pointer transition-colors text-left"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">Derived Accounts</div>
              <div className="text-xs text-muted mt-1">Enable multi-account support per wallet</div>
            </div>
            <Switch checked={enableDerivedAccounts} />
          </div>
        </button>
      </div>
    </div>
  )
}
