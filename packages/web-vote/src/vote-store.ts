export type VoteChoice = 'support' | 'oppose'

export interface VoteSnapshot {
  total: number
  support: number
  oppose: number
  choice: VoteChoice | null
}

export interface VoteRepository {
  read(voterHash?: string): VoteSnapshot | Promise<VoteSnapshot>
  cast(voterHash: string, choice: VoteChoice): VoteSnapshot | Promise<VoteSnapshot>
}

export class VoteStore implements VoteRepository {
  constructor(private readonly storage: Pick<DurableObjectStorage, 'sql' | 'transactionSync'>) {
    storage.transactionSync(() => {
      storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS votes (voter_hash TEXT PRIMARY KEY, choice TEXT NOT NULL DEFAULT 'support' CHECK (choice IN ('support', 'oppose')))"
      )
      storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS poll (id INTEGER PRIMARY KEY CHECK (id = 1), total INTEGER NOT NULL DEFAULT 0, support INTEGER NOT NULL DEFAULT 0 CHECK (support >= 0 AND support <= total))'
      )
      // Preserve votes from the original support-only poll when adding the second option.
      if (
        !storage.sql
          .exec<{ name: string }>('PRAGMA table_info(votes)')
          .toArray()
          .some(column => column.name === 'choice')
      ) {
        storage.sql.exec(
          "ALTER TABLE votes ADD COLUMN choice TEXT NOT NULL DEFAULT 'support' CHECK (choice IN ('support', 'oppose'))"
        )
      }
      if (
        !storage.sql
          .exec<{ name: string }>('PRAGMA table_info(poll)')
          .toArray()
          .some(column => column.name === 'support')
      ) {
        storage.sql.exec(
          'ALTER TABLE poll ADD COLUMN support INTEGER NOT NULL DEFAULT 0 CHECK (support >= 0 AND support <= total)'
        )
        storage.sql.exec('UPDATE poll SET support = total')
      }
      storage.sql.exec('INSERT INTO poll (id, total) VALUES (1, 0) ON CONFLICT (id) DO NOTHING')
    })
  }

  read(voterHash?: string): VoteSnapshot {
    const { total, support } = this.storage.sql
      .exec<{ total: number; support: number }>('SELECT total, support FROM poll WHERE id = 1')
      .one()
    const choice = voterHash
      ? this.storage.sql
          .exec<{
            choice: VoteChoice | null
          }>('SELECT (SELECT choice FROM votes WHERE voter_hash = ?) AS choice', voterHash)
          .one().choice
      : null
    return { total, support, oppose: total - support, choice }
  }

  cast(voterHash: string, choice: VoteChoice): VoteSnapshot {
    // The identity and count must commit together so retries cannot inflate the poll.
    return this.storage.transactionSync(() => {
      const inserted = this.storage.sql.exec(
        'INSERT INTO votes (voter_hash, choice) VALUES (?, ?) ON CONFLICT (voter_hash) DO NOTHING',
        voterHash,
        choice
      )
      if (inserted.rowsWritten > 0) {
        this.storage.sql.exec(
          'UPDATE poll SET total = total + 1, support = support + ? WHERE id = 1',
          choice === 'support' ? 1 : 0
        )
      }
      return this.read(voterHash)
    })
  }
}
