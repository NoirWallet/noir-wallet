import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from 'react'
import { EnglishCopy, useLocale } from '@/popup/i18n'
import { SendFormView } from './SendInputCards'

type SendFormProps = ComponentProps<typeof SendFormView>
type SendFormRegistration = { owner: symbol; props: SendFormProps; englishCopy: boolean }

const SendFormContext = createContext<Dispatch<SetStateAction<SendFormRegistration | null>> | null>(
  null
)

export function SendFormLayout({ children }: { readonly children: ReactNode }) {
  const [form, setForm] = useState<SendFormRegistration | null>(null)
  return (
    <SendFormContext.Provider value={setForm}>
      <div className="page-container">
        {children}
        {form && (
          <EnglishCopy active={form.englishCopy}>
            <SendFormView {...form.props} />
          </EnglishCopy>
        )}
      </div>
    </SendFormContext.Provider>
  )
}

export function useSharedSendForm(): boolean {
  return useContext(SendFormContext) !== null
}

export function SendFormSlot({ inline = false, ...props }: SendFormProps & { inline?: boolean }) {
  const context = useContext(SendFormContext)
  const register = inline ? null : context
  const [owner] = useState(() => Symbol())
  const englishCopy = useLocale() === 'en'

  // Update the shared form in the same commit as its adapter, before paint.
  useLayoutEffect(() => {
    register?.({ owner, props, englishCopy })
  })
  useLayoutEffect(
    () => () => register?.(current => (current?.owner === owner ? null : current)),
    [register, owner]
  )

  return register ? null : <SendFormView {...props} />
}
