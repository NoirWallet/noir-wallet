export interface SignupRepository {
  register(email: string, createdAt: number): void | Promise<void>
  ready(): void | Promise<void>
}

export class SignupStore implements SignupRepository {
  constructor(private readonly sql: Pick<SqlStorage, 'exec'>) {
    sql.exec(
      'CREATE TABLE IF NOT EXISTS frost_signups (email TEXT PRIMARY KEY, created_at INTEGER NOT NULL)'
    )
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
