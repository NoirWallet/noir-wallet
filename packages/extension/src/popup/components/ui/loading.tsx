import { Icon } from '@iconify/react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const loadingVariants = cva(
  'flex flex-col items-center justify-center gap-3 text-muted-foreground',
  {
    variants: {
      size: {
        sm: 'text-xs',
        default: 'text-sm',
        lg: 'text-base',
        xl: 'text-lg'
      },
      fullScreen: {
        true: 'fixed inset-0 z-50 bg-background/80 backdrop-blur-sm',
        false: 'w-full h-full min-h-[100px]'
      }
    },
    defaultVariants: {
      size: 'default',
      fullScreen: false
    }
  }
)

const spinnerVariants = cva('animate-spin text-primary', {
  variants: {
    size: {
      sm: 'w-4 h-4',
      default: 'w-6 h-6',
      lg: 'w-8 h-8',
      xl: 'w-12 h-12'
    }
  },
  defaultVariants: {
    size: 'default'
  }
})

interface LoadingProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof loadingVariants> {
  text?: string
  spinnerClassName?: string
}

export function Loading({
  className,
  size,
  fullScreen,
  text = 'Loading...',
  spinnerClassName,
  ...props
}: LoadingProps) {
  return (
    <div
      className={cn(loadingVariants({ size, fullScreen, className }))}
      data-testid="loading-spinner"
      {...props}
    >
      <Icon icon="lucide:loader-2" className={cn(spinnerVariants({ size }), spinnerClassName)} />
      {text && <p className="font-medium animate-pulse">{text}</p>}
    </div>
  )
}
