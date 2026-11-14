import { getDiagnosticErrorDetails, sanitizeDiagnosticMessage } from './diagnostic-log'

/** Keep vendor/WASM error text while excluding transaction and credential material. */
export function formatHardwareSigningError(error: unknown): string {
  const details = getDiagnosticErrorDetails(error)
  let message = typeof details === 'string' ? details : ''
  if (details && typeof details === 'object') {
    const fields = details as Record<string, unknown>
    message = [
      fields.name,
      fields.message,
      ...['code', 'status', 'statusCode'].flatMap(key =>
        typeof fields[key] === 'string' || typeof fields[key] === 'number'
          ? [`${key}=${fields[key]}`]
          : []
      )
    ]
      .filter(value => typeof value === 'string' && value.length > 0)
      .join(': ')
  }
  // PCZT/PSBT bytes may appear in upstream parser errors without a field name.
  return sanitizeDiagnosticMessage(
    (message || 'Hardware signing failed without an error message.')
      .replace(/\b[A-Za-z0-9+/_=-]{80,}\b/g, '[Encoded data redacted]')
      .replace(/\[\s*\d{1,3}(?:\s*,\s*\d{1,3}){15,}\s*\]/g, '[Bytes redacted]')
  )
}
