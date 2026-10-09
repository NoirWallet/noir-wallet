import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'

export interface OpenModalOptions<T = any> {
  title?: string
  body: (resolve: (value: T) => void, close: () => void) => React.ReactNode
  position?: 'center' | 'bottom'
  showCloseButton?: boolean
  className?: string
}

interface ModalConfig {
  id: string
  title?: string
  body: React.ReactNode
  position?: 'center' | 'bottom'
  showCloseButton?: boolean
  className?: string
  resolve: (value: any) => void
}

interface ModalContextType {
  openModal: <T>(options: OpenModalOptions<T>) => Promise<T>
}

const ModalContext = createContext<ModalContextType | null>(null)

let globalOpenModal: (<T>(options: OpenModalOptions<T>) => Promise<T>) | null = null

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [modals, setModals] = useState<ModalConfig[]>([])

  const openModalFn = useCallback(<T,>(options: OpenModalOptions<T>): Promise<T> => {
    return new Promise(resolve => {
      const id = `modal-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

      const close = () => {
        setModals(prev => prev.filter(m => m.id !== id))
      }

      const handleResolve = (value: T) => {
        close()
        resolve(value)
      }

      setModals(prev => [
        ...prev,
        {
          id,
          title: options.title,
          position: options.position || 'bottom',
          showCloseButton: options.showCloseButton !== false,
          className: options.className,
          body: options.body(handleResolve, close),
          resolve: handleResolve
        }
      ])
    })
  }, [])

  useEffect(() => {
    globalOpenModal = openModalFn
    return () => {
      globalOpenModal = null
    }
  }, [openModalFn])

  return (
    <ModalContext.Provider value={{ openModal: openModalFn }}>
      {children}
      {modals.map(modal => (
        <Dialog
          key={modal.id}
          open
          onOpenChange={(open: boolean) => {
            if (!open) {
              modal.resolve(undefined)
            }
          }}
        >
          <DialogContent
            position={modal.position}
            showCloseButton={modal.showCloseButton}
            className={modal.className}
          >
            {modal.title && (
              <DialogHeader>
                <DialogTitle>{modal.title}</DialogTitle>
                <DialogDescription className="sr-only">Modal dialog</DialogDescription>
              </DialogHeader>
            )}
            {!modal.title && (
              <DialogDescription className="sr-only">Modal dialog</DialogDescription>
            )}
            {modal.body}
          </DialogContent>
        </Dialog>
      ))}
    </ModalContext.Provider>
  )
}

export function useModal() {
  const context = useContext(ModalContext)
  if (!context) {
    throw new Error('useModal must be used within ModalProvider')
  }
  return context
}

export function openModal<T = any>(options: OpenModalOptions<T>): Promise<T> {
  if (!globalOpenModal) {
    throw new Error('Modal system not initialized. Wrap your app with ModalProvider.')
  }
  return globalOpenModal(options)
}
