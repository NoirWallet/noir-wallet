import type { MessageCatalog } from '@/popup/i18n'

export const sendMessages = {
  send: ['Send', '보내기', '傳送'],
  publicSend: ['Public Send', '공개 전송', '公開傳送'],
  sendMode: ['Send mode', '전송 모드', '傳送模式'],
  selectNetworkTitle: ['Select Network', '네트워크 선택', '選擇網路'],
  sendAsset: [
    'Send {symbol} on {network}',
    '{network}에서 {symbol} 보내기',
    '在 {network} 傳送 {symbol}'
  ],
  sendCustomAsset: [
    'Send {symbol} custom Token on {network}',
    '{network}에서 사용자 지정 토큰 {symbol} 보내기',
    '在 {network} 傳送自訂代幣 {symbol}'
  ],
  customToken: ['Custom', '사용자 지정', '自訂'],
  current: ['Current', '현재 계정', '目前帳戶'],
  loadingAccounts: ['Loading wallet accounts', '지갑 계정 불러오는 중', '正在載入錢包帳戶'],
  unavailableOnNetwork: [
    'Unavailable on this network',
    '이 네트워크에서 사용할 수 없음',
    '此網路無法使用'
  ],
  addMemoOptional: ['Memo (optional)', '메모 (선택 사항)', '備註（選填）'],
  clear: ['Clear', '지우기', '清除'],
  memoBytes: ['{count}/512 bytes', '{count}/512바이트', '{count}/512 位元組'],
  resolvingName: ['Resolving name...', '이름 확인 중…', '正在解析名稱…'],
  invalidZcash: [
    'Enter a valid Zcash address.',
    '유효한 Zcash 주소를 입력하세요.',
    '請輸入有效的 Zcash 地址。'
  ],
  solanaAddress: ['Solana address', 'Solana 주소', 'Solana 地址'],
  nearAddress: ['NEAR account ID', 'NEAR 계정 ID', 'NEAR 帳戶 ID'],
  bitcoinAddress: ['Bitcoin address', '비트코인 주소', '比特幣地址'],
  bitcoinTestnetAddress: ['Bitcoin testnet address', '비트코인 테스트넷 주소', '比特幣測試網地址'],
  amountInvalid: ['Enter a valid amount', '유효한 금액을 입력하세요', '請輸入有效金額'],
  insufficientGeneric: ['Insufficient balance', '잔액 부족', '餘額不足'],
  maxNetworkFee: ['Max network fee', '최대 네트워크 수수료', '最高網路手續費'],
  estimateFirstConfirmation: [
    'Estimated first confirmation based on recent blocks.',
    '최근 블록을 바탕으로 추정한 첫 확인 시간입니다.',
    '根據近期區塊估算的首次確認時間。'
  ],
  confirmationDependsOnNetwork: [
    'Approximate first confirmation; actual time depends on network conditions.',
    '첫 확인 예상 시간입니다. 실제 시간은 네트워크 상태에 따라 달라집니다.',
    '首次確認的預估時間，實際時間取決於網路狀況。'
  ],
  customTokenCaution: [
    'This transfer calls a custom Token contract you added. Verify the network, Token, and recipient.',
    '추가한 사용자 지정 토큰 계약을 사용하는 거래입니다. 네트워크, 토큰, 받는 사람을 확인하세요.',
    '此交易會呼叫您新增的自訂代幣合約。請確認網路、代幣與收款人。'
  ],
  needsBroadcast: ['Needs broadcast', '전파 필요', '等待重新廣播'],
  transactionReplaced: ['Transaction Replaced', '거래 대체됨', '交易已被替換'],
  transactionCancelled: ['Transaction Cancelled', '거래 취소됨', '交易已取消'],
  transactionRefunded: ['Transaction Refunded', '거래 환불됨', '交易已退款'],
  replacedDetail: [
    'Another transaction used the same network input.',
    '다른 거래에서 같은 네트워크 입력을 사용했습니다.',
    '另一筆交易使用了相同的網路輸入。'
  ],
  cancelledDetail: ['This transfer was cancelled.', '전송이 취소되었습니다.', '此筆交易已取消。'],
  refundedDetail: ['The transfer was refunded.', '전송 금액이 환불되었습니다.', '此筆交易已退款。'],
  confirmingStatus: ['Confirming', '확인 중', '確認中'],
  confirmedStatus: ['Confirmed', '확인 완료', '已確認'],
  submittedStatus: ['Submitted', '제출 완료', '已提交'],
  pendingStatus: ['Pending', '대기 중', '等待中'],
  failedStatus: ['Failed', '실패', '失敗'],
  reconfirmingStatus: ['Reconfirming', '재확인 중', '重新確認中'],
  replacedStatus: ['Replaced', '대체됨', '已被替換'],
  refundedStatus: ['Refunded', '환불됨', '已退款'],
  unexpectedFailure: ['Something went wrong', '문제가 발생했습니다', '發生問題'],
  confirmedOnChain: [
    'Your transaction has been confirmed on the blockchain.',
    '거래가 블록체인에서 확인되었습니다.',
    '交易已在區塊鏈上確認。'
  ],
  expiredBeforeMined: [
    'Your transaction expired before it was mined. Resend it with a higher fee.',
    '거래가 블록에 포함되기 전에 만료되었습니다. 더 높은 수수료로 다시 보내세요.',
    '交易在納入區塊前已逾時。請提高手續費後重新傳送。'
  ],
  unconfirmedOnChain: [
    'Your transaction could not be confirmed on the blockchain.',
    '블록체인에서 거래를 확인할 수 없습니다.',
    '無法在區塊鏈上確認此交易。'
  ],
  date: ['Date', '날짜', '日期'],
  to: ['To', '받는 곳', '目的地'],
  replacementHash: ['Replacement Hash', '대체 거래 해시', '替換交易雜湊'],
  chooseToken: ['Select Token', '토큰 선택', '選擇代幣'],
  addAddress: ['Add address', '주소 추가', '新增地址'],
  publicAddress: ['Public', '공개', '公開'],
  ownSendingAddress: [
    'This is the sending address.',
    '보내는 주소와 같습니다.',
    '此地址與傳送地址相同。'
  ],
  privateAddressUnavailable: [
    'Incognito addresses cannot be selected for Send.',
    '보내기에서 시크릿 주소를 선택할 수 없습니다.',
    '傳送時無法選擇無痕地址。'
  ],
  onlyPublicRecipients: [
    'Only Public accounts can be selected for this Send.',
    '이 전송에는 공개 계정만 선택할 수 있습니다.',
    '此筆交易僅能選擇公開帳戶。'
  ],
  copySender: ['Copy sender address', '보내는 주소 복사', '複製傳送地址'],
  copyRecipient: ['Copy recipient address', '받는 주소 복사', '複製收款地址'],
  confirmingCount: [
    'Confirming ({confirmed}/{required})',
    '확인 중 ({confirmed}/{required})',
    '確認中（{confirmed}/{required}）'
  ],
  statusUnavailable: [
    'Transaction status is not available yet. Check Activity before trying again.',
    '아직 거래 상태를 확인할 수 없습니다. 다시 시도하기 전에 활동을 확인하세요.',
    '目前無法取得交易狀態。請先查看活動，再試一次。'
  ],
  nameNotFound: ['Name not found', '이름을 찾을 수 없습니다', '找不到名稱'],
  nameResolutionFailed: ['Resolution failed', '이름을 확인할 수 없습니다', '無法解析名稱'],
  insufficientForTransaction: [
    'Insufficient balance for this transaction.',
    '이 거래를 처리하기에 잔액이 부족합니다.',
    '餘額不足，無法完成此筆交易。'
  ],
  amountTooSmall: [
    'Amount is too small to send.',
    '보내려는 금액이 너무 적습니다.',
    '金額過小，無法傳送。'
  ],
  badRecipient: [
    'Invalid recipient address. Please check and try again.',
    '잘못된 받는 주소입니다. 확인 후 다시 시도하세요.',
    '收款地址無效。請確認後再試一次。'
  ],
  sendTimedOut: [
    'Transaction timed out. Please check your transaction history and try again.',
    '거래 시간이 초과되었습니다. 거래 내역을 확인한 후 다시 시도하세요.',
    '交易逾時。請檢查交易記錄後再試一次。'
  ],
  createTransactionFailed: [
    'Failed to create transaction. Please try again.',
    '거래를 생성하지 못했습니다. 다시 시도하세요.',
    '無法建立交易。請再試一次。'
  ],
  requestCancelled: [
    'Request cancelled by user.',
    '사용자가 요청을 취소했습니다.',
    '使用者已取消要求。'
  ],
  requestFailed: ['Request failed.', '요청에 실패했습니다.', '要求失敗。'],
  requestDetailsUnavailable: [
    'Request failed. Error details unavailable.',
    '요청에 실패했습니다. 오류 세부 정보를 확인할 수 없습니다.',
    '要求失敗。無法取得錯誤詳細資訊。'
  ],
  pendingFunds: [
    'Wait for pending funds or lower the amount.',
    '대기 중인 자금이 확인될 때까지 기다리거나 금액을 줄이세요.',
    '請等待款項確認，或降低金額。'
  ],
  feeTitle: ['Network Fee', '네트워크 수수료', '網路手續費'],
  chooseFee: ['Select a network fee', '네트워크 수수료 선택', '選擇網路手續費'],
  estimateFee: ['Estimating network fee', '네트워크 수수료 계산 중', '正在估算網路手續費'],
  estimateTierFee: [
    'Estimating {tier} network fee',
    '{tier} 네트워크 수수료 계산 중',
    '正在估算{tier}網路手續費'
  ],
  feeUnavailable: ['Fee unavailable', '수수료를 확인할 수 없음', '無法取得手續費'],
  unavailable: ['Unavailable', '사용 불가', '無法使用'],
  editFee: ['Edit network fee', '네트워크 수수료 편집', '編輯網路手續費'],
  approximateFee: ['Approximate fee', '예상 수수료', '預估手續費'],
  feeSpeed: ['Network fee speed', '네트워크 수수료 속도', '手續費速度'],
  feeLow: ['Low', '낮음', '低'],
  feeStandard: ['Standard', '표준', '標準'],
  feeFast: ['Fast', '빠름', '快速'],
  feePriority: ['Priority', '우선', '優先'],
  approximateBlocks: ['~{count} blocks', '약 {count}블록', '約 {count} 個區塊'],
  seconds: ['{value} sec', '{value}초', '{value} 秒'],
  minutes: ['{value} min', '{value}분', '{value} 分鐘'],
  customGas: ['Custom gas', '가스 직접 설정', '自訂 Gas'],
  editGas: [
    'Edit gas parameters for this transaction',
    '이 거래의 가스 설정 편집',
    '編輯此筆交易的 Gas 參數'
  ],
  gasEstimateRequired: ['Gas estimate required', '가스 예상치 필요', '需要 Gas 預估值'],
  gasPrice: ['Gas price', '가스 가격', 'Gas 價格'],
  gasLimit: ['Gas limit', '가스 한도', 'Gas 上限'],
  feePerGas: ['Max fee per gas', '가스당 최대 수수료', '每單位 Gas 最高費用'],
  priorityFee: ['Max priority fee', '최대 우선 수수료', '最高優先費用'],
  updatingFee: ['Updating fee…', '수수료 갱신 중…', '正在更新手續費…'],
  updateFeeFailed: [
    'The network fee could not be updated.',
    '네트워크 수수료를 갱신할 수 없습니다.',
    '無法更新網路手續費。'
  ],
  invalidFee: ['Invalid network fee', '유효하지 않은 네트워크 수수료', '無效的網路手續費'],
  apply: ['Apply', '적용', '套用'],
  back: ['Back', '뒤로', '返回'],
  privacyWarning: [
    'This transfer may reveal a link between these addresses.',
    '이 거래로 인해 두 주소의 연결이 드러날 수 있습니다.',
    '此筆交易可能揭露這些地址之間的關聯。'
  ],
  ownIncognito: ['This is your Incognito address.', '내 시크릿 주소입니다.', '這是您的無痕地址。'],
  turnOnPrivate: [
    'Turn on Send privately to send to this Incognito address.',
    '이 시크릿 주소에 보내려면 비공개 전송을 켜세요.',
    '請開啟私密傳送功能，再傳送至此無痕地址。'
  ],
  shield: ['Shield', '보호', '隱私'],
  transparent: ['Transparent', '투명', '透明'],
  from: ['From', '보내는 곳', '來源'],
  sendFrom: ['Send from', '보내는 곳', '傳送來源'],
  sendTo: ['Send to', '받는 곳', '傳送至'],
  recipient: ['Recipient', '받는 사람', '收款人'],
  selectRecipient: ['Select Recipient', '받는 사람 선택', '選擇收款人'],
  recipientAddress: ['Recipient address', '받는 주소', '收款地址'],
  enterAddress: ['Enter address', '주소 입력', '輸入地址'],
  network: ['Network', '네트워크', '網路'],
  networksFor: ['Networks for {symbol}', '{symbol} 네트워크', '{symbol} 的網路'],
  selectNetwork: [
    'Select destination network, {network}',
    '받는 네트워크 선택, {network}',
    '選擇目的網路，{network}'
  ],
  selectAsset: [
    'Select send asset, {symbol} on {network}',
    '보낼 자산 선택, {network}의 {symbol}',
    '選擇傳送資產，{network} 上的 {symbol}'
  ],
  amount: ['Amount', '금액', '金額'],
  assetAmount: ['{symbol} amount', '{symbol} 금액', '{symbol} 金額'],
  balance: ['Bal.', '잔액', '餘額'],
  max: ['Max', '최대', '最大'],
  continue: ['Continue', '계속', '繼續'],
  confirm: ['Confirm', '확인', '確認'],
  confirmSend: ['Confirm Send', '보내기 확인', '確認傳送'],
  cancel: ['Cancel', '취소', '取消'],
  close: ['Close', '닫기', '關閉'],
  done: ['Done', '완료', '完成'],
  tryAgain: ['Try again', '다시 시도', '再試一次'],
  retry: ['Retry', '다시 시도', '重試'],
  sendAnyway: ['Send anyway', '그래도 보내기', '仍要傳送'],
  acceptChanges: ['Accept changes', '변경 사항 수락', '接受變更'],
  networkFee: ['Network fee', '네트워크 수수료', '網路手續費'],
  maximumFee: ['Maximum network fee', '최대 네트워크 수수료', '最高網路手續費'],
  fee: ['Fee', '수수료', '手續費'],
  total: ['Total', '합계', '總額'],
  maximumTotal: ['Maximum total', '최대 합계', '最高總額'],
  provider: ['Provider', '제공업체', '服務提供者'],
  estimatedTime: ['Est. time', '예상 시간', '預估時間'],
  inputs: ['Inputs', '입력 수', '輸入筆數'],
  addressType: ['Address type', '주소 유형', '地址類型'],
  mixedBitcoinInputs: ['Mixed Bitcoin inputs', '여러 유형의 비트코인 입력', '混合比特幣輸入類型'],
  memo: ['Memo', '메모', '備註'],
  addMemo: ['Add a private memo', '비공개 메모 추가', '新增私人備註'],
  memoUnsupported: [
    'This recipient cannot receive a memo.',
    '이 받는 주소는 메모를 받을 수 없습니다.',
    '此收款地址無法接收備註。'
  ],
  loadingTokens: ['Loading tokens', '토큰 불러오는 중', '正在載入代幣'],
  loadingAsset: ['Loading asset', '자산 불러오는 중', '正在載入資產'],
  loadTokensFailed: ['Unable to load tokens.', '토큰을 불러올 수 없습니다.', '無法載入代幣。'],
  noAssets: ['No assets found', '자산을 찾을 수 없습니다', '找不到資產'],
  noAccount: ['No account available', '사용할 수 있는 계정이 없습니다', '沒有可用的帳戶'],
  loadAccountFailed: ['Unable to load account.', '계정을 불러올 수 없습니다.', '無法載入帳戶。'],
  loadAccountsFailed: ['Unable to load accounts', '계정을 불러올 수 없습니다', '無法載入帳戶'],
  verifyAccountFailed: [
    'Unable to verify the current account.',
    '현재 계정을 확인할 수 없습니다.',
    '無法驗證目前的帳戶。'
  ],
  loadNetworks: ['Loading additional networks', '추가 네트워크 불러오는 중', '正在載入其他網路'],
  loadNetworksFailed: [
    'Additional networks are unavailable.',
    '추가 네트워크를 불러올 수 없습니다.',
    '無法載入其他網路。'
  ],
  comingSoon: ['Coming soon', '출시 예정', '即將推出'],
  addedToWallet: ['Added to wallet', '지갑에 추가됨', '已加入錢包'],
  sendZec: [
    'Send {source} ZEC on {network}',
    '{network}에서 {source} ZEC 보내기',
    '在 {network} 傳送{source} ZEC'
  ],
  searchRecipients: ['Search accounts or addresses', '계정 또는 주소 검색', '搜尋帳戶或地址'],
  myWallets: ['My Wallets', '내 지갑', '我的錢包'],
  addressBook: ['Address Book', '주소록', '通訊錄'],
  noMatchingAccounts: ['No matching accounts', '일치하는 계정이 없습니다', '沒有符合的帳戶'],
  noOtherAccounts: ['No other accounts', '다른 계정이 없습니다', '沒有其他帳戶'],
  noMatchingRecipients: [
    'No matching recipients',
    '일치하는 받는 사람이 없습니다',
    '沒有符合的收款人'
  ],
  noSavedRecipients: ['No saved recipients', '저장된 받는 사람이 없습니다', '沒有已儲存的收款人'],
  sendToName: ['Send to {name}', '{name}에게 보내기', '傳送至 {name}'],
  unavailableRecipient: [
    'Unavailable: {name}. {reason}',
    '{name} 사용 불가. {reason}',
    '{name} 無法使用。{reason}'
  ],
  reviewTransfer: [
    'Review the amount, destination, and fee.',
    '금액, 받는 곳, 수수료를 확인하세요.',
    '請確認金額、目的地和手續費。'
  ],
  reviewEvm: [
    'Review the asset, recipient, and maximum network fee before sending.',
    '보내기 전에 자산, 받는 사람, 최대 네트워크 수수료를 확인하세요.',
    '傳送前請確認資產、收款人和最高網路手續費。'
  ],
  reviewSolana: [
    'Review the Solana recipient and exact network fee before signing.',
    '서명하기 전에 Solana 받는 주소와 정확한 네트워크 수수료를 확인하세요.',
    '簽署前請確認 Solana 收款地址和確切的網路手續費。'
  ],
  reviewNear: [
    'Review the NEAR recipient and maximum network fee before signing.',
    '서명하기 전에 NEAR 받는 계정과 최대 네트워크 수수료를 확인하세요.',
    '簽署前請確認 NEAR 收款帳戶和最高網路手續費。'
  ],
  reviewBitcoin: [
    'Review the Bitcoin recipient, inputs, and exact network fee before sending.',
    '보내기 전에 비트코인 받는 주소, 입력, 정확한 네트워크 수수료를 확인하세요.',
    '傳送前請確認比特幣收款地址、交易輸入和確切的網路手續費。'
  ],
  invalidEvm: [
    'Enter a valid non-zero EVM address.',
    '0 주소가 아닌 유효한 EVM 주소를 입력하세요.',
    '請輸入有效且非零的 EVM 地址。'
  ],
  invalidSolana: [
    'Enter a valid Solana address.',
    '유효한 Solana 주소를 입력하세요.',
    '請輸入有效的 Solana 地址。'
  ],
  invalidNear: [
    'Enter a valid NEAR account ID.',
    '유효한 NEAR 계정 ID를 입력하세요.',
    '請輸入有效的 NEAR 帳戶 ID。'
  ],
  invalidBitcoin: [
    'Enter a valid Bitcoin address.',
    '유효한 비트코인 주소를 입력하세요.',
    '請輸入有效的比特幣地址。'
  ],
  invalidBitcoinTestnet: [
    'Enter a valid Bitcoin testnet address.',
    '유효한 비트코인 테스트넷 주소를 입력하세요.',
    '請輸入有效的比特幣測試網地址。'
  ],
  insufficient: ['Insufficient {symbol} balance', '{symbol} 잔액 부족', '{symbol} 餘額不足'],
  prepareFailed: [
    'The transfer could not be prepared. Please try again.',
    '전송을 준비할 수 없습니다. 다시 시도하세요.',
    '無法準備交易。請再試一次。'
  ],
  signFailed: [
    'The transaction could not be signed. Prepare the transfer again and retry.',
    '거래에 서명할 수 없습니다. 전송을 다시 준비하세요.',
    '無法簽署交易。請重新準備後再試一次。'
  ],
  reviewExpired: [
    'The review expired. Prepare the transfer again.',
    '검토 시간이 만료되었습니다. 전송을 다시 준비하세요.',
    '確認已逾時。請重新準備交易。'
  ],
  nearReviewExpired: [
    'The NEAR review expired. Prepare the transfer again.',
    'NEAR 검토 시간이 만료되었습니다. 전송을 다시 준비하세요.',
    'NEAR 確認已逾時。請重新準備交易。'
  ],
  blockhashExpired: [
    'The recent blockhash expired. Prepare the transfer again.',
    '최근 블록 해시가 만료되었습니다. 전송을 다시 준비하세요.',
    '近期區塊雜湊已過期。請重新準備交易。'
  ],
  reviewUnavailable: [
    'This review is no longer available. Check Activity before preparing another transfer.',
    '이 거래를 더 이상 검토할 수 없습니다. 다시 준비하기 전에 활동을 확인하세요.',
    '此交易已無法確認。請先查看活動，再準備另一筆交易。'
  ],
  reviewMismatch: [
    'The {network} review does not match the requested transfer.',
    '{network} 검토 내용이 요청한 전송과 일치하지 않습니다.',
    '{network} 確認內容與要求的交易不符。'
  ],
  invalidReview: [
    'The wallet returned an invalid {network} review.',
    '지갑에서 유효하지 않은 {network} 검토 내용을 반환했습니다.',
    '錢包傳回無效的 {network} 確認內容。'
  ],
  networkUnavailable: [
    '{network} is unavailable. Check your connection and try again.',
    '{network}에 연결할 수 없습니다. 연결을 확인한 후 다시 시도하세요.',
    '無法連線至 {network}。請檢查連線後再試一次。'
  ],
  networkUnavailableGeneric: [
    'The network is unavailable. Check your connection and try again.',
    '네트워크에 연결할 수 없습니다. 연결을 확인한 후 다시 시도하세요.',
    '無法連線至網路。請檢查連線後再試一次。'
  ],
  nonceBlocked: [
    'An earlier transaction needs attention. Open Activity to resolve its nonce before sending.',
    '이전 거래를 처리해야 합니다. 보내기 전에 활동에서 논스 문제를 해결하세요.',
    '有先前的交易需要處理。請先前往活動解決 nonce 問題。'
  ],
  noEvmAccount: [
    'This wallet does not have an EVM account.',
    '이 지갑에는 EVM 계정이 없습니다.',
    '此錢包沒有 EVM 帳戶。'
  ],
  noSolanaAccount: [
    'This Wallet does not have a Solana account.',
    '이 지갑에는 Solana 계정이 없습니다.',
    '此錢包沒有 Solana 帳戶。'
  ],
  noBitcoinAccount: [
    'This Wallet does not have a Bitcoin account.',
    '이 지갑에는 비트코인 계정이 없습니다.',
    '此錢包沒有比特幣帳戶。'
  ],
  noNearKey: [
    'This Account has no usable full-access NEAR key.',
    '이 계정에는 사용할 수 있는 NEAR 전체 액세스 키가 없습니다.',
    '此帳戶沒有可用的 NEAR 完整存取金鑰。'
  ],
  assetUnavailable: [
    'This asset is unavailable for sending.',
    '이 자산은 보낼 수 없습니다.',
    '此資產無法傳送。'
  ],
  checkAmountAddress: [
    'Check the amount and recipient address.',
    '금액과 받는 주소를 확인하세요.',
    '請檢查金額和收款地址。'
  ],
  checkSolanaAmountAddress: [
    'Check the amount and Solana address.',
    '금액과 Solana 주소를 확인하세요.',
    '請檢查金額和 Solana 地址。'
  ],
  checkBitcoinAmountAddress: [
    'Check the amount and Bitcoin address.',
    '금액과 비트코인 주소를 확인하세요.',
    '請檢查金額和比特幣地址。'
  ],
  checkNearAmountAddress: [
    'Check the amount and ensure the recipient account already exists.',
    '금액과 받는 계정이 이미 존재하는지 확인하세요.',
    '請檢查金額，並確認收款帳戶已存在。'
  ],
  maximumFailed: [
    'Could not calculate maximum amount',
    '최대 금액을 계산할 수 없습니다',
    '無法計算最大金額'
  ],
  estimateFeeFailed: [
    'Could not estimate network fee',
    '네트워크 수수료를 계산할 수 없습니다',
    '無法估算網路手續費'
  ],
  checkingSync: ['Checking sync status', '동기화 상태 확인 중', '正在檢查同步狀態'],
  checkSyncFailed: [
    'Could not check sync status',
    '동기화 상태를 확인할 수 없습니다',
    '無法檢查同步狀態'
  ],
  resync: ['Resync Zcash', 'Zcash 다시 동기화', '重新同步 Zcash'],
  resyncRequired: [
    'Wallet data needs to be resynced before sending again.',
    '다시 보내려면 지갑 데이터를 다시 동기화해야 합니다.',
    '重新傳送前，請重新同步錢包資料。'
  ],
  speedUp: ['Speed Up', '속도 높이기', '加速'],
  amountOrFeeChanged: [
    'The amount or network fee changed. Review the updated transfer.',
    '금액 또는 네트워크 수수료가 변경되었습니다. 변경된 전송을 확인하세요.',
    '金額或網路手續費已變更。請確認更新後的交易。'
  ],
  refreshingFee: ['Refreshing network fee…', '네트워크 수수료 갱신 중…', '正在更新網路手續費…'],
  waitingForWallet: ['Waiting for wallet...', '지갑 응답 대기 중…', '正在等待錢包回應…'],
  waitingForSync: [
    'Waiting for sync to complete before sending...',
    '동기화가 완료되면 전송합니다…',
    '同步完成後將傳送交易…'
  ],
  buildingTransaction: [
    'Building and broadcasting your transaction. This may take a few minutes.',
    '거래를 생성하고 전파하는 중입니다. 몇 분이 걸릴 수 있습니다.',
    '正在建立及廣播交易，可能需要幾分鐘。'
  ],
  submitting: ['Transaction Submitting', '거래 제출 중', '正在提交交易'],
  reconfirming: ['Reconfirming Transaction', '거래 재확인 중', '正在重新確認交易'],
  reconfirmingDetail: [
    'The chain changed before finality. Confirmations are being checked again.',
    '거래 확정 전에 체인이 변경되었습니다. 확인 상태를 다시 확인하는 중입니다.',
    '區塊鏈在交易確定前發生變更，正在重新檢查確認狀態。'
  ],
  confirmed: ['Transaction Confirmed', '거래 확인 완료', '交易已確認'],
  confirmedDetail: [
    'Your transfer is finalized on-chain.',
    '전송이 온체인에서 확정되었습니다.',
    '交易已在鏈上確定。'
  ],
  confirming: ['Confirming Transaction', '거래 확인 중', '正在確認交易'],
  confirmingDetail: [
    'Your transfer is on-chain and waiting for finality.',
    '전송이 온체인에 기록되었으며 확정을 기다리고 있습니다.',
    '交易已上鏈，正在等待最終確認。'
  ],
  failed: ['Transaction Failed', '거래 실패', '交易失敗'],
  failedDetail: [
    'The network could not complete this transfer.',
    '네트워크에서 전송을 완료할 수 없습니다.',
    '網路無法完成此筆交易。'
  ],
  pending: ['Transaction Pending', '거래 대기 중', '交易等待中'],
  pendingDetail: [
    'The wallet is preparing this transaction.',
    '지갑에서 거래를 준비하는 중입니다.',
    '錢包正在準備交易。'
  ],
  interrupted: ['Broadcast Interrupted', '거래 전파 중단', '廣播中斷'],
  interruptedDetail: [
    'The signed transaction is stored locally and can be broadcast again.',
    '서명된 거래가 이 기기에 저장되어 다시 전파할 수 있습니다.',
    '已簽署的交易已儲存在此裝置，可重新廣播。'
  ],
  submitted: ['Transaction Submitted', '거래 제출 완료', '交易已提交'],
  submittedDetail: [
    'Submitted. Waiting for block inclusion.',
    '제출되었습니다. 블록에 포함되기를 기다리고 있습니다.',
    '交易已提交，正在等待納入區塊。'
  ],
  viewExplorer: ['View on Explorer', '탐색기에서 보기', '在區塊瀏覽器查看'],
  viewActivity: ['View Activity', '활동 보기', '查看活動'],
  failureReason: ['Reason', '사유', '原因'],
  expired: ['Expired before confirmation', '확인 전에 만료됨', '在確認前逾時'],
  dropped: ['Dropped by the network', '네트워크에서 제거됨', '已被網路捨棄'],
  reverted: ['Reverted on-chain', '온체인에서 되돌려짐', '已在鏈上還原'],
  verificationFailed: ['Security verification failed', '보안 검증 실패', '安全性驗證失敗'],
  cancelled: ['Cancelled', '취소됨', '已取消'],
  confirmationFailed: ['Could not be confirmed', '확인할 수 없음', '無法確認'],
  status: ['Status', '상태', '狀態'],
  time: ['Time', '시간', '時間'],
  txHash: ['Transaction Hash', '거래 해시', '交易雜湊'],
  statusDelayed: ['Status update delayed.', '상태 업데이트가 지연되고 있습니다.', '狀態更新延遲。'],
  retryBroadcast: ['Retry broadcast', '거래 다시 전파', '重新廣播'],
  retryBroadcastFailed: [
    'Broadcast retry failed. Check the network and try again.',
    '거래를 다시 전파하지 못했습니다. 네트워크를 확인한 후 다시 시도하세요.',
    '重新廣播失敗。請檢查網路後再試一次。'
  ]
} as const satisfies MessageCatalog
