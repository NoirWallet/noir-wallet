import {
  nearPublicKeyFromImplicitAccountId,
  parseNearAccountId,
  parseNearBase58,
  parseNearPublicKey
} from '@/core/chains/near'
import { parseAssetId, parseChainId } from '@/core/chains/registry'
import { parseNearLendingSupplyBinding } from '@/core/services/lending-near-supply'
import type { NearReadRpc } from './near-rpc-types'
import { encodeNearFunctionArgs } from './near-rpc-codecs'
import type { NearTransferAction, NearTransferTransaction } from './near-transfer-preparer'

const MAXIMUM_U64 = 18_446_744_073_709_551_615n
const MAXIMUM_U128 = 340_282_366_920_938_463_463_374_607_431_768_211_455n
const STORAGE_DEPOSIT_YOCTO = 1_250_000_000_000_000_000_000n
const STORAGE_DEPOSIT_GAS = 50_000_000_000_000n
const WRAP_NEAR_GAS = 50_000_000_000_000n
const LENDING_TRANSFER_GAS = 250_000_000_000_000n

export interface PrepareNearLendingSupplyInput {
  readonly chainId: string
  readonly accountIndex: number
  readonly assetId: string
  readonly signerId: string
  readonly publicKey: string
  readonly recipientId: string
  readonly tokenContractId: string
  readonly amountRaw: string
  readonly customRecipientMsg: string
  readonly rpc: Pick<
    NearReadRpc,
    | 'assertExpectedChain'
    | 'getAccount'
    | 'getAccessKey'
    | 'getGasPrice'
    | 'getNativeTransferCostConfig'
    | 'getFungibleTokenBalance'
    | 'isFungibleTokenAccountRegistered'
  >
  readonly signal?: AbortSignal
}

export interface PreparedNearLendingSupply {
  readonly kind: 'lending-supply'
  readonly chainId: string
  readonly accountIndex: number
  readonly assetId: string
  readonly sourceKind: 'native' | 'token'
  readonly signerId: string
  readonly publicKey: string
  readonly recipientId: string
  readonly tokenContractId: string
  readonly amountRaw: string
  readonly customRecipientMsg: string
  readonly estimatedFeeYocto: string
  readonly maximumFeeYocto: string
  readonly storageReserveYocto: string
  readonly protocolDepositYocto: string
  readonly totalRequiredYocto: string
  readonly transaction: NearTransferTransaction
}

function parseUnsigned(value: unknown, maximum: bigint, label: string): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be unsigned decimal`)
  }
  const parsed = BigInt(value)
  if (parsed > maximum) throw new Error(`${label} exceeds its protocol limit`)
  return parsed
}

function parseAccountIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0x7fffffff) {
    throw new Error('Invalid NEAR account index')
  }
  return value as number
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function checkedU128(value: bigint, label: string): bigint {
  if (value > MAXIMUM_U128) throw new Error(`${label} exceeds u128`)
  return value
}

function functionCall(
  methodName: string,
  args: Readonly<Record<string, unknown>>,
  gas: bigint,
  depositYocto: bigint
): NearTransferAction {
  return Object.freeze({
    type: 'functionCall' as const,
    methodName,
    args: encodeNearFunctionArgs(args),
    gas: gas.toString(),
    depositYocto: depositYocto.toString()
  })
}

function assertSigner(signerId: string, publicKey: string): void {
  if (
    /^[0-9a-f]{64}$/.test(signerId) &&
    nearPublicKeyFromImplicitAccountId(signerId) !== publicKey
  ) {
    throw new Error('NEAR signer does not match its public key')
  }
}

export async function prepareNearLendingSupply(
  input: PrepareNearLendingSupplyInput
): Promise<PreparedNearLendingSupply> {
  const chain = parseChainId(input.chainId)
  if (chain.namespace !== 'near') throw new Error('NEAR Lending Supply requires a NEAR chain')
  const accountIndex = parseAccountIndex(input.accountIndex)
  const signerId = parseNearAccountId(input.signerId, 'NEAR signer account ID')
  const publicKey = parseNearPublicKey(input.publicKey)
  assertSigner(signerId, publicKey)
  const recipientId = parseNearAccountId(input.recipientId, 'NEAR Lending recipient')
  const tokenContractId = parseNearAccountId(input.tokenContractId, 'NEAR token contract')
  const binding = parseNearLendingSupplyBinding(
    { tokenContractId, recipientId, customRecipientMsg: input.customRecipientMsg },
    signerId
  )
  const asset = parseAssetId(input.assetId)
  if (asset.chainId !== chain.id) throw new Error('NEAR Lending asset has the wrong chain')
  const sourceKind = asset.namespace === 'slip44' && asset.reference === '397' ? 'native' : 'token'
  if (
    sourceKind === 'token' &&
    (asset.namespace !== 'nep141' || asset.reference.replace(/%5F/gi, '_') !== tokenContractId)
  ) {
    throw new Error('NEAR Lending token asset does not match its contract')
  }
  const amount = parseUnsigned(input.amountRaw, MAXIMUM_U128, 'NEAR Lending Supply amount')
  if (amount === 0n) throw new Error('NEAR Lending Supply amount must be greater than zero')

  await input.rpc.assertExpectedChain(input.signal)
  const [sender, accessKey, gasPriceRaw, costs, senderRegistered, recipientRegistered] =
    await Promise.all([
      input.rpc.getAccount(signerId, input.signal),
      input.rpc.getAccessKey(signerId, publicKey, input.signal),
      input.rpc.getGasPrice(input.signal),
      input.rpc.getNativeTransferCostConfig(input.signal),
      sourceKind === 'native'
        ? input.rpc.isFungibleTokenAccountRegistered(tokenContractId, signerId, input.signal)
        : Promise.resolve(true),
      input.rpc.isFungibleTokenAccountRegistered(tokenContractId, recipientId, input.signal)
    ])
  if (!sender) throw new Error('NEAR sender account was not found')
  if (!accessKey) throw new Error('The derived NEAR access key is not registered')
  if (accessKey.permission.kind !== 'full-access') {
    throw new Error('NEAR Lending Supply requires a full-access key')
  }
  if (sourceKind === 'token') {
    const tokenBalance = await input.rpc.getFungibleTokenBalance(
      tokenContractId,
      signerId,
      input.signal
    )
    if (BigInt(tokenBalance.amountRaw) < amount) {
      throw new Error('NEAR token balance is insufficient')
    }
  }

  const actions: NearTransferAction[] = []
  let protocolDeposit = 1n
  let totalGas = LENDING_TRANSFER_GAS
  if (!senderRegistered) {
    actions.push(
      functionCall(
        'storage_deposit',
        { account_id: signerId, registration_only: true },
        STORAGE_DEPOSIT_GAS,
        STORAGE_DEPOSIT_YOCTO
      )
    )
    protocolDeposit += STORAGE_DEPOSIT_YOCTO
    totalGas += STORAGE_DEPOSIT_GAS
  }
  if (sourceKind === 'native') {
    actions.push(functionCall('near_deposit', {}, WRAP_NEAR_GAS, amount))
    protocolDeposit += amount
    totalGas += WRAP_NEAR_GAS
  }
  if (!recipientRegistered && recipientId !== signerId) {
    actions.push(
      functionCall(
        'storage_deposit',
        { account_id: recipientId, registration_only: true },
        STORAGE_DEPOSIT_GAS,
        STORAGE_DEPOSIT_YOCTO
      )
    )
    protocolDeposit += STORAGE_DEPOSIT_YOCTO
    totalGas += STORAGE_DEPOSIT_GAS
  }
  actions.push(
    functionCall(
      'ft_transfer_call',
      { receiver_id: recipientId, amount: amount.toString(), msg: binding.customRecipientMsg },
      LENDING_TRANSFER_GAS,
      1n
    )
  )

  const nonce = parseUnsigned(accessKey.nonce, MAXIMUM_U64, 'NEAR access key nonce')
  if (nonce === MAXIMUM_U64) throw new Error('NEAR access key nonce is exhausted')
  const gasPrice = parseUnsigned(gasPriceRaw, MAXIMUM_U128, 'NEAR gas price')
  const minimumGasPrice = parseUnsigned(
    costs.minGasPurchasePriceRaw,
    MAXIMUM_U128,
    'NEAR minimum gas purchase price'
  )
  const estimatedFee = checkedU128(totalGas * gasPrice, 'NEAR estimated fee')
  const maximumFee = checkedU128(
    totalGas * (gasPrice > minimumGasPrice ? gasPrice : minimumGasPrice),
    'NEAR maximum fee'
  )
  const storageAmountPerByte = parseUnsigned(
    costs.storageAmountPerByteRaw,
    MAXIMUM_U128,
    'NEAR storage amount per byte'
  )
  const storageReserve = checkedU128(
    BigInt(sender.storageUsage) * storageAmountPerByte,
    'NEAR storage reserve'
  )
  const totalRequired = checkedU128(
    maximumFee + storageReserve + protocolDeposit,
    'NEAR total debit'
  )
  if (totalRequired > parseUnsigned(sender.amountRaw, MAXIMUM_U128, 'NEAR sender balance')) {
    throw new Error('NEAR balance cannot cover the Lending Supply transaction')
  }

  return Object.freeze({
    kind: 'lending-supply' as const,
    chainId: chain.id,
    accountIndex,
    assetId: asset.id,
    sourceKind,
    signerId,
    publicKey,
    recipientId,
    tokenContractId,
    amountRaw: amount.toString(),
    customRecipientMsg: binding.customRecipientMsg,
    estimatedFeeYocto: estimatedFee.toString(),
    maximumFeeYocto: maximumFee.toString(),
    storageReserveYocto: storageReserve.toString(),
    protocolDepositYocto: protocolDeposit.toString(),
    totalRequiredYocto: totalRequired.toString(),
    transaction: Object.freeze({
      chainId: chain.id,
      accountIndex,
      signerId,
      receiverId: tokenContractId,
      nonce: (nonce + 1n).toString(),
      blockHash: accessKey.blockHash,
      actions: Object.freeze(actions)
    })
  })
}

export function parsePreparedNearLendingSupply(value: unknown): PreparedNearLendingSupply {
  const record = readRecord(value, 'Prepared NEAR Lending Supply')
  const required = [
    'kind',
    'chainId',
    'accountIndex',
    'assetId',
    'sourceKind',
    'signerId',
    'publicKey',
    'recipientId',
    'tokenContractId',
    'amountRaw',
    'customRecipientMsg',
    'estimatedFeeYocto',
    'maximumFeeYocto',
    'storageReserveYocto',
    'protocolDepositYocto',
    'totalRequiredYocto',
    'transaction'
  ]
  if (
    Object.keys(record).length !== required.length ||
    !required.every(key => Object.prototype.hasOwnProperty.call(record, key)) ||
    record.kind !== 'lending-supply' ||
    (record.sourceKind !== 'native' && record.sourceKind !== 'token') ||
    typeof record.chainId !== 'string' ||
    typeof record.assetId !== 'string'
  ) {
    throw new Error('Invalid prepared NEAR Lending Supply')
  }
  const chain = parseChainId(record.chainId)
  if (chain.namespace !== 'near') {
    throw new Error('Prepared NEAR Lending Supply requires a NEAR chain')
  }
  const accountIndex = parseAccountIndex(record.accountIndex)
  const signerId = parseNearAccountId(record.signerId)
  const publicKey = parseNearPublicKey(record.publicKey)
  assertSigner(signerId, publicKey)
  const binding = parseNearLendingSupplyBinding(
    {
      tokenContractId: record.tokenContractId,
      recipientId: record.recipientId,
      customRecipientMsg: record.customRecipientMsg
    },
    signerId
  )
  const asset = parseAssetId(record.assetId)
  if (asset.chainId !== chain.id) throw new Error('Prepared NEAR Lending asset has the wrong chain')
  if (
    (record.sourceKind === 'native' &&
      !(asset.namespace === 'slip44' && asset.reference === '397')) ||
    (record.sourceKind === 'token' &&
      (asset.namespace !== 'nep141' ||
        asset.reference.replace(/%5F/gi, '_') !== binding.tokenContractId))
  ) {
    throw new Error('Prepared NEAR Lending asset does not match its source kind')
  }
  const amountRaw = parseUnsigned(record.amountRaw, MAXIMUM_U128, 'NEAR Supply amount').toString()
  if (amountRaw === '0') throw new Error('NEAR Supply amount must be greater than zero')
  const estimatedFeeYocto = parseUnsigned(
    record.estimatedFeeYocto,
    MAXIMUM_U128,
    'NEAR estimated fee'
  ).toString()
  const maximumFeeYocto = parseUnsigned(
    record.maximumFeeYocto,
    MAXIMUM_U128,
    'NEAR maximum fee'
  ).toString()
  const storageReserveYocto = parseUnsigned(
    record.storageReserveYocto,
    MAXIMUM_U128,
    'NEAR storage reserve'
  ).toString()
  const protocolDepositYocto = parseUnsigned(
    record.protocolDepositYocto,
    MAXIMUM_U128,
    'NEAR protocol deposit'
  ).toString()
  const totalRequiredYocto = parseUnsigned(
    record.totalRequiredYocto,
    MAXIMUM_U128,
    'NEAR total debit'
  ).toString()
  if (
    BigInt(estimatedFeeYocto) > BigInt(maximumFeeYocto) ||
    BigInt(totalRequiredYocto) !==
      BigInt(maximumFeeYocto) + BigInt(storageReserveYocto) + BigInt(protocolDepositYocto)
  ) {
    throw new Error('Invalid prepared NEAR Lending debit')
  }
  const transaction = readRecord(record.transaction, 'Prepared NEAR Lending transaction')
  if (
    transaction.chainId !== chain.id ||
    transaction.accountIndex !== accountIndex ||
    transaction.signerId !== signerId ||
    transaction.receiverId !== binding.tokenContractId ||
    typeof transaction.nonce !== 'string' ||
    typeof transaction.blockHash !== 'string' ||
    !Array.isArray(transaction.actions) ||
    transaction.actions.length === 0
  ) {
    throw new Error('Prepared NEAR Lending transaction does not match its binding')
  }
  if (parseUnsigned(transaction.nonce, MAXIMUM_U64, 'NEAR transaction nonce') === 0n) {
    throw new Error('NEAR transaction nonce must be greater than zero')
  }
  parseNearBase58(transaction.blockHash, 32, 'Prepared NEAR block hash')
  const actions = transaction.actions.map((value, index) => {
    const action = readRecord(value, `Prepared NEAR Lending action ${index + 1}`)
    if (
      action.type !== 'functionCall' ||
      typeof action.methodName !== 'string' ||
      typeof action.args !== 'string' ||
      typeof action.gas !== 'string' ||
      typeof action.depositYocto !== 'string'
    ) {
      throw new Error('Invalid prepared NEAR Lending action')
    }
    parseUnsigned(action.gas, MAXIMUM_U64, 'NEAR action gas')
    parseUnsigned(action.depositYocto, MAXIMUM_U128, 'NEAR action deposit')
    return Object.freeze({
      type: 'functionCall' as const,
      methodName: action.methodName,
      args: action.args,
      gas: action.gas,
      depositYocto: action.depositYocto
    })
  })
  let cursor = 0
  const signerStorageArgs = encodeNearFunctionArgs({
    account_id: signerId,
    registration_only: true
  })
  const recipientStorageArgs = encodeNearFunctionArgs({
    account_id: binding.recipientId,
    registration_only: true
  })
  const isStorageAction = (action: (typeof actions)[number] | undefined, args: string) =>
    action?.methodName === 'storage_deposit' &&
    action.args === args &&
    action.gas === STORAGE_DEPOSIT_GAS.toString() &&
    action.depositYocto === STORAGE_DEPOSIT_YOCTO.toString()
  if (record.sourceKind === 'native' && isStorageAction(actions[cursor], signerStorageArgs)) {
    cursor += 1
  }
  if (record.sourceKind === 'native') {
    const wrapAction = actions[cursor]
    if (
      wrapAction?.methodName !== 'near_deposit' ||
      wrapAction.args !== encodeNearFunctionArgs({}) ||
      wrapAction.gas !== WRAP_NEAR_GAS.toString() ||
      wrapAction.depositYocto !== amountRaw
    ) {
      throw new Error('Prepared NEAR Lending wrap action does not match its amount')
    }
    cursor += 1
  }
  if (binding.recipientId !== signerId && isStorageAction(actions[cursor], recipientStorageArgs)) {
    cursor += 1
  }
  const finalAction = actions.at(-1)
  const expectedFinalArgs = encodeNearFunctionArgs({
    receiver_id: binding.recipientId,
    amount: amountRaw,
    msg: binding.customRecipientMsg
  })
  if (
    finalAction?.methodName !== 'ft_transfer_call' ||
    finalAction.args !== expectedFinalArgs ||
    finalAction.gas !== LENDING_TRANSFER_GAS.toString() ||
    finalAction.depositYocto !== '1'
  ) {
    throw new Error('Prepared NEAR Lending transfer call does not match its binding')
  }
  if (cursor !== actions.length - 1) {
    throw new Error('Prepared NEAR Lending action sequence is invalid')
  }
  const actualProtocolDeposit = actions.reduce(
    (total, action) => total + BigInt(action.depositYocto),
    0n
  )
  if (actualProtocolDeposit.toString() !== protocolDepositYocto) {
    throw new Error('Prepared NEAR Lending protocol deposit does not match its actions')
  }
  return Object.freeze({
    kind: 'lending-supply' as const,
    chainId: chain.id,
    accountIndex,
    assetId: asset.id,
    sourceKind: record.sourceKind,
    signerId,
    publicKey,
    recipientId: binding.recipientId,
    tokenContractId: binding.tokenContractId,
    amountRaw,
    customRecipientMsg: binding.customRecipientMsg,
    estimatedFeeYocto,
    maximumFeeYocto,
    storageReserveYocto,
    protocolDepositYocto,
    totalRequiredYocto,
    transaction: Object.freeze({
      chainId: chain.id,
      accountIndex,
      signerId,
      receiverId: binding.tokenContractId,
      nonce: transaction.nonce,
      blockHash: transaction.blockHash,
      actions: Object.freeze(actions)
    })
  })
}
