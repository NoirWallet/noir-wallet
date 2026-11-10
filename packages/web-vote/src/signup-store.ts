import type { MailDiagnostic } from './mail-delivery'

export interface SignupRepository {
  register(email: string, createdAt: number): void | Promise<void>
  ready(): void | Promise<void>
}

export class SignupStore implements SignupRepository {
  constructor(
    private readonly sql: Pick<SqlStorage, 'exec'>,
    private readonly transaction: <T>(callback: () => T) => T = callback => callback()
  ) {
    sql.exec(
      'CREATE TABLE IF NOT EXISTS frost_signups (email TEXT PRIMARY KEY, created_at INTEGER NOT NULL)'
    )
    sql.exec(
      'CREATE TABLE IF NOT EXISTS signup_mail (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error_code TEXT, error_stage TEXT, smtp_code INTEGER, error_name TEXT)'
    )
    const columns = new Set(
      sql
        .exec<{ name: string }>('PRAGMA table_info(signup_mail)')
        .toArray()
        .map(column => column.name)
    )
    for (const [name, type] of [
      ['error_code', 'TEXT'],
      ['error_stage', 'TEXT'],
      ['smtp_code', 'INTEGER'],
      ['error_name', 'TEXT']
    ]) {
      if (!columns.has(name)) sql.exec(`ALTER TABLE signup_mail ADD COLUMN ${name} ${type}`)
    }
    sql.exec(
      'CREATE TABLE IF NOT EXISTS signup_mail_clock (id INTEGER PRIMARY KEY CHECK(id = 1), next_at INTEGER NOT NULL)'
    )
    sql.exec('INSERT OR IGNORE INTO signup_mail_clock VALUES (1, 0)')
    // A restarted object cannot prove whether an interrupted SMTP send was accepted.
    sql.exec(
      "UPDATE signup_mail SET status = 'unknown', error_code='WORKER_INTERRUPTED', error_stage='SEND' WHERE status = 'sending'"
    )
  }

  registerWithMail(email: string, createdAt: number, id: string): void {
    this.transaction(() => {
      const inserted = this.sql
        .exec<{
          email: string
        }>(
          'INSERT INTO frost_signups (email, created_at) VALUES (?, ?) ON CONFLICT (email) DO NOTHING RETURNING email',
          email,
          createdAt
        )
        .toArray()
      if (inserted.length)
        this.sql.exec(
          "INSERT INTO signup_mail (id, email, status, next_at, updated_at) VALUES (?, ?, 'pending', ?, ?)",
          id,
          email,
          createdAt,
          createdAt
        )
    })
  }

  claimMail(now: number): { id: string; email: string; attempts: number } | null {
    return this.transaction(() => {
      const rows = this.sql
        .exec<{
          id: string
          email: string
          attempts: number
        }>(
          "UPDATE signup_mail SET status='sending', attempts=attempts+1, updated_at=? WHERE id=(SELECT id FROM signup_mail WHERE status='pending' AND next_at<=? ORDER BY next_at, id LIMIT 1) AND ? >= (SELECT next_at FROM signup_mail_clock WHERE id=1) RETURNING id, email, attempts",
          now,
          now,
          now
        )
        .toArray()
      if (!rows.length) return null
      this.sql.exec('UPDATE signup_mail_clock SET next_at=? WHERE id=1', now + 60000)
      return rows[0] ?? null
    })
  }

  finishMail(
    id: string,
    outcome: 'sent' | 'retry' | 'failed' | 'unknown',
    now: number,
    diagnostic: MailDiagnostic | null = null
  ): void {
    this.sql.exec(
      "UPDATE signup_mail SET status=CASE WHEN ?='retry' AND attempts<3 THEN 'pending' WHEN ?='retry' THEN 'failed' ELSE ? END, next_at=? + attempts * 300000, updated_at=?, error_code=?, error_stage=?, smtp_code=?, error_name=? WHERE id=? AND status='sending'",
      outcome,
      outcome,
      outcome,
      now,
      now,
      diagnostic?.code ?? null,
      diagnostic?.stage ?? null,
      diagnostic?.smtpCode ?? null,
      diagnostic?.name ?? null,
      id
    )
  }

  nextMailTime(): number | null {
    return this.sql
      .exec<{
        next_at: number | null
      }>(
        "SELECT MIN(MAX(next_at, (SELECT next_at FROM signup_mail_clock WHERE id=1))) AS next_at FROM signup_mail WHERE status='pending'"
      )
      .one().next_at
  }

  register(email: string, createdAt: number): void {
    // Retries retain the first signup time and reveal no membership information.
    this.sql.exec(
      'INSERT INTO frost_signups (email, created_at) VALUES (?, ?) ON CONFLICT (email) DO NOTHING',
      email,
      createdAt
    )
  }

  ready(): void {
    this.sql.exec('SELECT 1 AS ready').one()
  }
}
