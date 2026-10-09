const ERC20_APPROVE_CALL_PATTERN = /^0x095ea7b3[0-9a-f]{128}$/

export function isErc20ApproveCalldata(value: string | undefined): boolean {
  return value !== undefined && ERC20_APPROVE_CALL_PATTERN.test(value.toLowerCase())
}
