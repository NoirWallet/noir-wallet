import type { MessageCatalog } from '@/popup/i18n'

export const portfolioMessages = {
  total: ['Total', '합계', '總計'],
  shield: ['Shield', '실드', '屏蔽'],
  public: ['Public', '공개', '公開'],
  incognito: ['Incognito', '시크릿', '無痕'],
  deposit: ['Deposit', '입금', '存入'],
  withdraw: ['Withdraw', '출금', '提領'],
  send: ['Send', '보내기', '傳送'],
  receive: ['Receive', '받기', '接收'],
  shieldAction: ['Shield', '실드로 전환', '啟用屏蔽'],
  unshield: ['Unshield', '실드 해제', '解除屏蔽'],
  swap: ['Swap', '스왑', '兌換'],
  retry: ['Retry', '다시 시도', '重試'],
  tryAgain: ['Try again', '다시 시도', '再試一次'],
  retrying: ['Retrying...', '다시 시도 중…', '重試中…'],
  restore: ['Restore', '복원', '還原'],
  openMenu: ['Open menu', '메뉴 열기', '開啟選單'],
  menu: ['Menu', '메뉴', '選單'],
  accounts: ['Accounts', '계정', '帳戶'],
  dappConnections: ['DApp connections', 'DApp 연결', 'DApp 連線'],
  settings: ['Settings', '설정', '設定'],
  tokens: ['Tokens', '토큰', '代幣'],
  providers: ['Providers', '서비스 제공자', '服務提供者'],
  dapps: ['DApps', 'DApps', 'DApps'],
  activity: ['Activity', '활동', '活動'],
  assets: ['Assets', '자산', '資產'],
  loadAddressesFailed: [
    'Unable to load account addresses',
    '계정 주소를 불러올 수 없습니다',
    '無法載入帳戶地址'
  ],
  receiveLoadAddressesFailed: [
    'Unable to load account addresses.',
    '계정 주소를 불러올 수 없습니다.',
    '無法載入帳戶地址。'
  ],
  syncRetryFailed: [
    'Unable to retry Zcash sync',
    'Zcash 동기화를 다시 시작할 수 없습니다',
    '無法重試 Zcash 同步'
  ],
  openRecoveryFailed: [
    'Unable to open Zcash recovery',
    'Zcash 복원 화면을 열 수 없습니다',
    '無法開啟 Zcash 還原'
  ],
  syncPaused: ['Sync paused', '동기화 일시 중지', '同步已暫停'],
  syncNetworkError: ['Network error', '네트워크 오류', '網路錯誤'],
  syncInterrupted: ['Sync interrupted', '동기화 중단', '同步已中斷'],
  syncWalletError: [
    'Could not load Zcash data',
    'Zcash 데이터를 불러올 수 없습니다',
    '無法載入 Zcash 資料'
  ],
  syncRestoreDescription: [
    'Restore Zcash to resume syncing your balance and history.',
    'Zcash를 복원하여 잔액과 활동 내역 동기화를 재개하세요.',
    '還原 Zcash 以繼續同步餘額與活動紀錄。'
  ],
  incognitoUnavailable: [
    'Incognito mode is unavailable for this account',
    '이 계정에서는 시크릿 모드를 사용할 수 없습니다',
    '此帳戶無法使用無痕模式'
  ],
  addNetworks: ['Add More Networks', '네트워크 추가', '新增網路'],
  addNow: ['Add now', '지금 추가', '立即新增'],
  moreNetworks: [
    'Ethereum, BNB Chain, Base and more…',
    'Ethereum, BNB Chain, Base 등…',
    'Ethereum、BNB Chain、Base 等…'
  ],
  balanceHidden: ['Balance hidden', '잔액 숨김', '餘額已隱藏'],
  partialBalance: ['Partial balance', '일부 잔액', '部分餘額'],
  walletBalances: ['Wallet balances', '지갑 잔액', '錢包餘額'],
  showBalances: ['Show balances', '잔액 표시', '顯示餘額'],
  hideBalances: ['Hide balances', '잔액 숨기기', '隱藏餘額'],
  walletBalanceMode: ['Wallet balance mode', '지갑 잔액 모드', '錢包餘額模式'],
  namedBalance: ['{name} balance', '{name} 잔액', '{name}餘額'],
  exploreProviders: [
    'Explore privacy providers',
    '프라이버시 서비스 둘러보기',
    '探索隱私服務提供者'
  ],
  shieldCombinedBalance: [
    'Your combined balance across privacy providers. Shielding keeps this balance hidden from public view onchain.',
    '프라이버시 서비스의 잔액 합계입니다. 실드를 적용하면 이 잔액은 온체인에 공개되지 않습니다.',
    '所有隱私服務的合計餘額。屏蔽可讓這筆餘額不在鏈上公開。'
  ],
  shieldTotal: [
    'Total across privacy providers',
    '프라이버시 서비스 잔액 합계',
    '所有隱私服務的餘額合計'
  ],
  remainsUnshielded: [
    '{name} remains unshielded.',
    '{name}에 아직 실드가 적용되지 않았습니다.',
    '{name}尚未屏蔽。'
  ],
  availableToShield: ['{name} available to shield', '{name} 실드 전환 가능', '{name}可屏蔽'],
  moveEligibleToShield: [
    'Move eligible tokens from Public to Shield.',
    '지원되는 토큰을 공개에서 실드로 옮기세요.',
    '將支援的代幣從公開轉入屏蔽。'
  ],
  shieldTokensNow: ['Shield tokens now', '지금 실드로 전환', '立即屏蔽代幣'],
  portfolio: ['Portfolio', '자산 현황', '資產總覽'],
  loadingPortfolio: ['Loading portfolio', '자산 현황 불러오는 중', '正在載入資產總覽'],
  loadingNetworkBalances: [
    'Loading balances from enabled networks.',
    '활성 네트워크의 잔액을 불러오는 중입니다.',
    '正在載入已啟用網路的餘額。'
  ],
  loadPortfolioFailed: [
    'Unable to load portfolio',
    '자산 현황을 불러올 수 없습니다',
    '無法載入資產總覽'
  ],
  reconnecting: [
    'Noir Wallet is reconnecting automatically.',
    'Noir Wallet이 자동으로 다시 연결하고 있습니다.',
    'Noir Wallet 正在自動重新連線。'
  ],
  reconnectingDataSafe: [
    'Your wallet data is safe. Noir Wallet is reconnecting automatically.',
    '지갑 데이터는 안전합니다. Noir Wallet이 자동으로 다시 연결하고 있습니다.',
    '您的錢包資料是安全的。Noir Wallet 正在自動重新連線。'
  ],
  noActiveAccount: ['No active account', '활성 계정 없음', '沒有使用中的帳戶'],
  selectAccount: [
    'Select an account to view its assets.',
    '자산을 보려면 계정을 선택하세요.',
    '選擇帳戶以查看資產。'
  ],
  updateBalanceFailed: [
    'Unable to update balance',
    '잔액을 업데이트할 수 없습니다',
    '無法更新餘額'
  ],
  balanceUnavailable: ['Balance unavailable', '잔액을 확인할 수 없음', '無法取得餘額'],
  retryNamedBalance: ['Retry {name} balance', '{name} 잔액 다시 확인', '重新取得 {name} 餘額'],
  namedBalanceUnavailable: [
    '{name} balance unavailable',
    '{name} 잔액을 확인할 수 없음',
    '無法取得 {name} 餘額'
  ],
  unavailable: ['Unavailable', '확인할 수 없음', '無法取得'],
  shieldAssets: ['Shield assets', '실드 자산', '屏蔽資產'],
  filterNetworks: ['Filter portfolio by network', '네트워크로 자산 필터링', '依網路篩選資產'],
  portfolioDataSyncing: [
    'Portfolio data is syncing',
    '자산 데이터를 동기화하는 중',
    '正在同步資產資料'
  ],
  portfolioSyncing: ['Syncing portfolio', '자산 현황 동기화 중', '正在同步資產總覽'],
  syncing: ['Syncing', '동기화 중', '同步中'],
  portfolioView: ['Portfolio view', '자산 보기 방식', '資產檢視方式'],
  viewByToken: ['View by token', '토큰별로 보기', '依代幣檢視'],
  showTokenView: ['Show token view', '토큰 보기 표시', '顯示代幣檢視'],
  viewByNetwork: ['View by network', '네트워크별로 보기', '依網路檢視'],
  showChainView: ['Show chain view', '네트워크 보기 표시', '顯示網路檢視'],
  portfolioOptions: ['Portfolio options', '자산 현황 옵션', '資產總覽選項'],
  manageTokens: ['Manage tokens', '토큰 관리', '管理代幣'],
  refreshList: ['Refresh list', '목록 새로 고침', '重新整理清單'],
  noNetworks: ['No networks available', '사용 가능한 네트워크 없음', '沒有可用的網路'],
  noNetworkSelected: ['No network selected', '선택한 네트워크 없음', '尚未選擇網路'],
  noAssets: ['No assets found', '자산 없음', '找不到資產'],
  noNetworkAssets: ['No assets on this network', '이 네트워크에 자산이 없습니다', '此網路沒有資產'],
  viewDetailsOnNetwork: [
    'View {symbol} details on {network}',
    '{network}의 {symbol} 상세 보기',
    '查看 {network} 上的 {symbol} 詳細資料'
  ],
  collapseLowValue: ['Collapse low value assets', '소액 자산 접기', '收合低價值資產'],
  expandLowValue: ['Expand low value assets', '소액 자산 펼치기', '展開低價值資產'],
  lowValue: ['Low value', '소액 자산', '低價值資產'],
  namedPortfolio: ['{name} portfolio', '{name} 자산 현황', '{name} 資產總覽'],
  collapseNetworkTokens: ['Collapse {name} tokens', '{name} 토큰 접기', '收合 {name} 代幣'],
  expandNetworkTokens: ['Expand {name} tokens', '{name} 토큰 펼치기', '展開 {name} 代幣'],
  networkTokenBalances: ['{name} token balances', '{name} 토큰 잔액', '{name} 代幣餘額'],
  collapse: ['Collapse', '접기', '收合'],
  viewMore: ['View more', '더 보기', '查看更多'],
  shieldNamed: ['Shield {name}', '{name} 실드로 전환', '屏蔽 {name}'],
  pendingAmount: [
    '{amount} {symbol} pending',
    '{amount} {symbol} 대기 중',
    '{amount} {symbol} 待確認'
  ],
  change24h: ['24h change', '24시간 변동', '24 小時變動'],
  lastChange24h: [
    'Last available 24h change',
    '마지막으로 확인된 24시간 변동',
    '最近可用的 24 小時變動'
  ],
  namedChange24h: ['{change} over 24 hours', '24시간 동안 {change}', '24 小時變動 {change}'],
  lastNamedChange24h: [
    '{change} over 24 hours, last available data',
    '24시간 동안 {change}, 마지막으로 확인된 데이터',
    '24 小時變動 {change}，最近可用的資料'
  ],
  collapseTokenNetworks: ['Collapse {name} networks', '{name} 네트워크 접기', '收合 {name} 網路'],
  expandTokenNetworks: ['Expand {name} networks', '{name} 네트워크 펼치기', '展開 {name} 網路'],
  tokenNetworkBalances: ['{name} network balances', '{name} 네트워크별 잔액', '{name} 各網路餘額'],
  assetDetails: ['Asset details', '자산 상세 정보', '資產詳情'],
  loadingAsset: ['Loading asset', '자산 불러오는 중', '正在載入資產'],
  assetUnavailable: ['Asset unavailable', '자산을 확인할 수 없음', '無法取得資產'],
  refreshAssetFailed: [
    'This asset could not be refreshed. Check your connection.',
    '이 자산을 새로 고칠 수 없습니다. 연결 상태를 확인하세요.',
    '無法重新整理此資產。請檢查網路連線。'
  ],
  assetNotInAccount: [
    'This asset is not available for the active Wallet and Account.',
    '현재 지갑과 계정에서 이 자산을 사용할 수 없습니다.',
    '目前的錢包與帳戶無法使用此資產。'
  ],
  viewBalance: ['View {name} balance', '{name} 잔액 보기', '查看 {name} 餘額'],
  copyNamedAddress: ['Copy {name} address', '{name} 주소 복사', '複製 {name} 地址'],
  addressCopied: ['Address copied', '주소를 복사했습니다', '已複製地址'],
  tokenDetails: ['Token details', '토큰 상세 정보', '代幣詳情'],
  network: ['Network', '네트워크', '網路'],
  receiveAddress: ['Receive address', '받는 주소', '收款地址'],
  copyBitcoinAddress: [
    'Copy Bitcoin receive address',
    'Bitcoin 받는 주소 복사',
    '複製 Bitcoin 收款地址'
  ],
  receiveBitcoin: ['Receive Bitcoin', 'Bitcoin 받기', '接收 Bitcoin'],
  contractAddress: ['Contract address', '컨트랙트 주소', '合約地址'],
  copyContractAddress: ['Copy contract address', '컨트랙트 주소 복사', '複製合約地址'],
  viewTokenExplorer: ['View token on explorer', '탐색기에서 토큰 보기', '在區塊鏈瀏覽器查看代幣'],
  viewNetworkExplorer: ['View network explorer', '네트워크 탐색기 보기', '開啟區塊鏈瀏覽器'],
  balanceView: ['Balance view', '잔액 보기 방식', '餘額檢視方式'],
  accountBalances: ['Account balances', '계정 잔액', '帳戶餘額'],
  bitcoinAccounts: ['Bitcoin accounts', 'Bitcoin 계정 목록', 'Bitcoin 帳戶列表'],
  bitcoinAccount: ['Bitcoin account', 'Bitcoin 계정', 'Bitcoin 帳戶'],
  addresses: ['Addresses', '주소', '地址'],
  bitcoinAccountSwitchFailed: [
    'Unable to switch the Bitcoin account.',
    'Bitcoin 계정을 전환할 수 없습니다.',
    '無法切換 Bitcoin 帳戶。'
  ],
  zcashBreakdown: ['Zcash balance breakdown', 'Zcash 잔액 내역', 'Zcash 餘額明細'],
  zcashShield: ['Zcash Shield', 'Zcash 실드', 'Zcash 屏蔽'],
  transparent: ['Transparent', '투명', '透明'],
  chartUnavailable: ['Chart unavailable', '차트를 불러올 수 없음', '無法載入圖表'],
  balanceBreakdown: ['Balance breakdown', '잔액 내역', '餘額明細'],
  balance: ['Balance', '잔액', '餘額'],
  pending: ['Pending', '대기 중', '待確認'],
  priceAsOf: ['Price as of {date}', '{date} 기준 가격', '截至 {date} 的價格'],
  priceHistory: ['{range} price history', '{range} 가격 내역', '{range}價格紀錄'],
  priceHistoryRange: ['Price history range', '가격 내역 기간', '價格紀錄期間'],
  range1d: ['1D', '1일', '1 天'],
  range1w: ['1W', '1주', '1 週'],
  range1m: ['1M', '1개월', '1 個月'],
  range3m: ['3M', '3개월', '3 個月'],
  range1y: ['1Y', '1년', '1 年'],
  rangeAll: ['All', '전체', '全部'],
  period24h: ['24h', '24시간', '24 小時'],
  address: ['Address', '주소', '地址'],
  loadingAddresses: ['Loading addresses', '주소 불러오는 중', '正在載入地址'],
  noAccount: ['No account available', '사용 가능한 계정 없음', '沒有可用的帳戶'],
  account: ['Account', '계정', '帳戶'],
  searchNetwork: ['Search Network', '네트워크 검색', '搜尋網路'],
  noMatchingNetworks: ['No matching networks', '일치하는 네트워크 없음', '找不到符合的網路'],
  accountNetworkAddresses: [
    'Account network addresses',
    '계정의 네트워크별 주소',
    '帳戶的各網路地址'
  ],
  noEnabledNetworkAddresses: [
    'No enabled network addresses are available for this account.',
    '이 계정에 활성화된 네트워크 주소가 없습니다.',
    '此帳戶沒有已啟用的網路地址。'
  ],
  loadAccountAddressesFailed: [
    'Unable to load addresses for this account.',
    '이 계정의 주소를 불러올 수 없습니다.',
    '無法載入此帳戶的地址。'
  ],
  otherChains: ['Other chains', '다른 체인', '其他鏈'],
  otherChainsAddressMode: [
    'Other chains address mode',
    '다른 체인의 주소 모드',
    '其他鏈的地址模式'
  ],
  addNamed: ['Add {name}', '{name} 추가', '新增 {name}'],
  addNetworkNamed: ['Add {name} network', '{name} 네트워크 추가', '新增 {name} 網路'],
  openZcashSettings: ['Open Zcash settings', 'Zcash 설정 열기', '開啟 Zcash 設定'],
  zcashSettings: ['Zcash settings', 'Zcash 설정', 'Zcash 設定'],
  copy: ['Copy', '복사', '複製'],
  copied: ['Copied', '복사됨', '已複製'],
  copyAddress: ['Copy address', '주소 복사', '複製地址'],
  showQr: ['Show QR code', 'QR 코드 표시', '顯示 QR Code'],
  copyTypedAddress: [
    'Copy {network} {type} address',
    '{network} {type} 주소 복사',
    '複製 {network} {type}地址'
  ],
  showTypedAddressQr: [
    'Show {network} {type} address QR code',
    '{network} {type} 주소 QR 코드 표시',
    '顯示 {network} {type}地址的 QR Code'
  ],
  typedAddress: ['{network} {type} address', '{network} {type} 주소', '{network} {type}地址'],
  namedAddressQr: ['{name} address QR code', '{name} 주소 QR 코드', '{name} 地址的 QR Code'],
  receivingAddress: ['Receiving Address', '받는 주소', '收款地址'],
  closeReceivingAddress: ['Close receiving address', '받는 주소 닫기', '關閉收款地址'],
  publicAddressWarning: [
    'This address and its activity are publicly visible on-chain.',
    '이 주소와 활동은 온체인에 공개됩니다.',
    '此地址及其活動可在鏈上公開查看。'
  ],
  scanToReceive: [
    'Scan this code to receive funds.',
    '자금을 받으려면 이 코드를 스캔하세요.',
    '掃描此 QR Code 即可接收資金。'
  ],
  addressTypeShielded: ['shielded', '실드', '屏蔽'],
  addressTypeTransparent: ['transparent', '투명', '透明'],
  addressTypeMixed: ['mixed', '혼합', '混合'],
  addressModePublic: ['public', '공개', '公開'],
  addressModePrivate: ['private', '시크릿', '無痕'],
  addressTypeLegacy: ['Legacy', '레거시', '傳統']
} as const satisfies MessageCatalog
