export async function scheduleSpendabilityCatchUp(
  scheduleDurableCatchUp: () => Promise<unknown>,
  markScheduled: () => Promise<void>,
  runForegroundCatchUp: () => Promise<unknown>
): Promise<void> {
  await scheduleDurableCatchUp()
  await markScheduled()
  await runForegroundCatchUp()
}
