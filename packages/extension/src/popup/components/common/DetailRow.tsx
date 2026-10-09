export interface DetailRowProps {
  label: string
  children: React.ReactNode
}

export function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-muted">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}
