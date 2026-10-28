import {
  registerProtocolFixtures,
  captureScreenshot,
  expect,
  expectNoOverflow,
  importTestWallet,
  mockBitcoinNetwork,
  mockEvmNetwork,
  mockProtocolApis,
  test,
  waitForBackgroundWalletInitialization
} from '../../helpers/protocol-wallet'

registerProtocolFixtures()

test('renders RHEA multi-asset lending positions on Home', async ({ context, popup }) => {
  test.setTimeout(180_000)
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context, {
    mcaId: 'rhea00000x.multica.near',
    includeMultichainMarkets: true
  })

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.getByRole('tab', { name: 'Lending' }).click()
  await expect(popup.locator('[data-home-lending-position="eth.bridge.near"]')).toContainText(
    '1.5 ETH',
    {
      timeout: 30_000
    }
  )
  await expect(popup.getByText('$3,750.00', { exact: true }).first()).toBeVisible()
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'protocol-wallet-home-lending-multichain-positions.png')
})
