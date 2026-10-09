export function isIncompleteCommitmentTreeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('CommitmentTree(Query(TreeIncomplete')
}

export async function runWithCommitmentTreeRecovery<T>({
  isFresh,
  refresh,
  operation
}: {
  isFresh: () => boolean
  refresh: () => Promise<void>
  operation: () => Promise<T>
}): Promise<T> {
  if (!isFresh()) {
    await refresh()
  }

  try {
    return await operation()
  } catch (error) {
    if (!isIncompleteCommitmentTreeError(error)) {
      throw error
    }

    await refresh()
    return operation()
  }
}
