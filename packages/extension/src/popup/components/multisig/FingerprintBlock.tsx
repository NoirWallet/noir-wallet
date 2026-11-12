interface FingerprintBlockProps {
  value: string
}

/** Large monospace block for comparing the group fingerprint across devices by eye. */
export function FingerprintBlock({ value }: FingerprintBlockProps) {
  return (
    <div className="rounded-xl bg-card px-4 py-5 text-center font-mono text-lg tracking-wide break-words">
      {value}
    </div>
  )
}
