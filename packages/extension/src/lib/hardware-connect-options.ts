export const HARDWARE_CONNECT_OPTIONS = [
  { vendor: 'ledger', name: 'Ledger' },
  { vendor: 'keystone', name: 'Keystone' }
] as const

export type HardwareConnectVendor = (typeof HARDWARE_CONNECT_OPTIONS)[number]['vendor']

export function hardwareConnectRoute(vendor?: HardwareConnectVendor): string {
  return vendor ? `/hardware/${vendor}-connect` : '/hardware/connect'
}
