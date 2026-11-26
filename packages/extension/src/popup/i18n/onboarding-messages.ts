import type { MessageCatalog } from '@/popup/i18n'

export const onboardingMessages = {
  wallet: ['Wallet', '지갑', '錢包'],
  welcome: ['Welcome to Noir Wallet', 'Noir Wallet에 오신 것을 환영합니다', '歡迎使用 Noir Wallet'],
  welcomeDescription: [
    'Safely manage your assets.',
    '자산을 안전하게 관리하세요.',
    '安全管理您的資產。'
  ],
  createWalletButton: ['Create Wallet', '지갑 만들기', '建立錢包'],
  createWallet: ['Create wallet', '지갑 만들기', '建立錢包'],
  importWallet: ['Import wallet', '지갑 가져오기', '匯入錢包'],
  importWalletButton: ['Import Wallet', '지갑 가져오기', '匯入錢包'],
  connectHardwareWallet: ['Connect Hardware Wallet', '하드웨어 지갑 연결', '連接硬體錢包'],
  continue: ['Continue', '계속', '繼續'],
  next: ['Next', '다음', '下一步'],
  confirm: ['Confirm', '확인', '確認'],
  retry: ['Retry', '다시 시도', '重試'],
  cancel: ['Cancel', '취소', '取消'],
  congratulations: ['Congratulations!', '축하합니다!', '恭喜！'],
  walletReady: [
    'Your wallet is ready. You can now securely send, receive, and store digital assets.',
    '지갑 준비가 완료되었습니다. 이제 디지털 자산을 안전하게 보내고 받고 보관할 수 있습니다.',
    '您的錢包已準備就緒。現在可以安全地傳送、接收及保管數位資產。'
  ],
  gotIt: ['Got it', '알겠습니다', '知道了'],
  firstAccountName: ['First account name', '첫 번째 계정 이름', '第一個帳戶名稱'],
  accountName: ['Account name', '계정 이름', '帳戶名稱'],
  accountNameExample: ['Account 1', '계정 1', '帳戶 1'],
  accountNameInvalid: [
    'Account name must contain 1-{max} characters',
    '계정 이름은 1~{max}자여야 합니다',
    '帳戶名稱須包含 1 至 {max} 個字元'
  ],
  phraseLength: ['Recovery phrase length', '복구 문구 길이', '助記詞長度'],
  words: ['{count} words', '단어 {count}개', '{count} 個單字'],
  wordNumber: ['Word {number}', '{number}번째 단어', '第 {number} 個單字'],
  phraseRestoresAccounts: [
    'Your Secret Recovery Phrase restores every account in this wallet.',
    '복구 문구로 이 지갑의 모든 계정을 복원할 수 있습니다.',
    '使用助記詞，即可還原此錢包中的所有帳戶。'
  ],
  networks: ['Networks', '네트워크', '網路'],
  accountNetworks: ['Account networks', '계정 네트워크', '帳戶網路'],
  evmNetworks: ['Ethereum & EVM', '이더리움 및 EVM', '以太坊與 EVM'],
  networkAddress: ['{network} address', '{network} 주소', '{network} 地址'],
  loading: ['Loading…', '불러오는 중…', '載入中…'],
  zcashSyncWarning: [
    'Zcash synchronization takes time. Uncheck Zcash if you don’t need it now. You can add it later.',
    'Zcash 동기화에는 시간이 걸립니다. 지금 필요하지 않다면 선택을 해제하세요. 나중에 추가할 수 있습니다.',
    '同步 Zcash 需要一些時間。若目前不需要，可取消選取，日後再新增。'
  ],
  selectNetwork: [
    'Select at least one network',
    '네트워크를 하나 이상 선택하세요',
    '請至少選擇一個網路'
  ],
  secureWallet: ['Secure your wallet', '지갑 보호하기', '保護您的錢包'],
  backUpNow: [
    'Secure your assets — back up your Secret Recovery Phrase now.',
    '자산을 보호하려면 비밀 복구 문구를 지금 백업하세요.',
    '立即備份秘密助記詞，保護您的資產。'
  ],
  backupNextScreen: [
    "On the next screen, you'll see your {count}-word Secret Recovery Phrase.",
    '다음 화면에서 단어 {count}개로 된 복구 문구를 확인할 수 있습니다.',
    '下一個畫面會顯示由 {count} 個單字組成的助記詞。'
  ],
  protectPhrase: ['Protect your recovery phrase', '복구 문구 보호하기', '保護您的助記詞'],
  storeSafely: ['Store it safely:', '안전하게 보관하세요:', '妥善保管：'],
  writeDown: [
    'Write it down and keep it in a secure location.',
    '복구 문구를 적어 안전한 곳에 보관하세요.',
    '請抄寫下來並存放在安全的地方。'
  ],
  neverShare: ['Never share it:', '절대 공유하지 마세요:', '絕對不要分享：'],
  phraseAccessWarning: [
    'Anyone with this phrase gains permanent access to your assets. No official or support agent will ever ask for it.',
    '이 구문을 알면 누구든 자산에 영구적으로 접근할 수 있습니다. 공식 담당자나 지원팀은 이 구문을 절대 요청하지 않습니다.',
    '任何取得這組助記詞的人都能永久存取您的資產。官方或客服人員絕不會要求您提供助記詞。'
  ],
  startBackup: ['Start backup', '백업 시작', '開始備份'],
  viewPhrase: ['View Secret Phrase', '복구 문구 보기', '查看助記詞'],
  loadingPhrase: ['Loading recovery phrase', '복구 문구를 불러오는 중', '正在載入助記詞'],
  savePhraseWarning: [
    'Store these {count} words securely to restore your wallet anytime. Never share them, or you could lose your assets.',
    '언제든 지갑을 복원할 수 있도록 이 단어 {count}개를 안전하게 보관하세요. 다른 사람과 공유하면 자산을 잃을 수 있습니다.',
    '請妥善保管這 {count} 個單字，以便日後還原錢包。切勿分享，以免失去資產。'
  ],
  phraseSaved: ['I have saved it', '복구 문구를 저장했습니다', '我已備份'],
  confirmPhrase: ['Confirm Recovery Phrase', '복구 문구 확인', '確認助記詞'],
  selectPhraseWords: [
    'Select the {first} and {second} words.',
    '{first}번째와 {second}번째 단어를 선택하세요.',
    '請選擇第 {first} 和第 {second} 個單字。'
  ],
  selectedWords: ['Selected words:', '선택한 단어:', '已選擇的單字：'],
  ordinal: ['{number}', '{number}번째', '第 {number} 個'],
  creatingWallet: ['Creating wallet...', '지갑을 만드는 중…', '正在建立錢包…'],
  creating: ['Creating...', '만드는 중…', '建立中…'],
  phraseMismatch: [
    'Selected words do not match. Please try again.',
    '선택한 단어가 일치하지 않습니다. 다시 시도하세요.',
    '選擇的單字不符，請再試一次。'
  ],
  confirmBeforeCreate: [
    'Confirm your recovery phrase before creating the wallet',
    '지갑을 만들기 전에 복구 문구를 확인하세요',
    '建立錢包前，請先確認助記詞'
  ],
  generatePhraseFailed: [
    'Failed to generate seed phrase',
    '복구 문구를 생성하지 못했습니다',
    '無法產生助記詞'
  ],
  unexpectedPhraseLength: [
    'Secure module returned an unexpected recovery phrase length',
    '보안 모듈에서 예상과 다른 길이의 복구 문구를 반환했습니다',
    '安全模組產生的助記詞長度不符'
  ],
  createFailed: ['Failed to create wallet', '지갑을 만들지 못했습니다', '無法建立錢包'],
  importPhrase: ['Import Secret Recovery Phrase', '복구 문구 가져오기', '匯入助記詞'],
  enterPhrase: [
    'Enter your {count}-word Secret Recovery Phrase',
    '단어 {count}개로 된 복구 문구를 입력하세요',
    '請輸入由 {count} 個單字組成的助記詞'
  ],
  exactWordCount: [
    'Recovery phrase must contain exactly {count} words.',
    '복구 문구는 정확히 단어 {count}개여야 합니다.',
    '助記詞必須正好包含 {count} 個單字。'
  ],
  invalidEnglishWords: [
    'Highlighted words are not in the BIP-39 English word list.',
    '표시된 단어는 BIP-39 영어 단어 목록에 없습니다.',
    '標示的單字不在 BIP-39 英文單字清單中。'
  ],
  invalidChecksum: [
    'Recovery phrase checksum is invalid. Check the words and their order.',
    '복구 문구의 체크섬이 올바르지 않습니다. 단어와 순서를 확인하세요.',
    '助記詞的總和檢查碼無效，請確認單字及順序。'
  ],
  importAccounts: ['Import Accounts', '계정 가져오기', '匯入帳戶'],
  foundAccount: ['We found 1 account', '계정 1개를 찾았습니다', '找到 1 個帳戶'],
  accountSelected: ['1 account selected', '계정 1개 선택됨', '已選擇 1 個帳戶'],
  noAccountsSelected: ['0 accounts selected', '선택된 계정 없음', '未選擇帳戶'],
  selectAccount: ['Select account', '계정 선택', '選擇帳戶'],
  addressesFailed: ['Could not load addresses.', '주소를 불러오지 못했습니다.', '無法載入地址。'],
  importFailed: ['Failed to import wallet', '지갑을 가져오지 못했습니다', '無法匯入錢包'],
  zcashSetup: ['Zcash account setup', 'Zcash 계정 설정', '設定 Zcash 帳戶'],
  zcashReceivedBefore: [
    'Has this phrase received ZEC before?',
    '이 복구 문구로 ZEC를 받은 적이 있나요?',
    '這組助記詞曾經接收過 ZEC 嗎？'
  ],
  newZcashAccount: ['New Zcash Account', '새 Zcash 계정', '新的 Zcash 帳戶'],
  restoreZcashAccount: ['Restore Zcash Account', 'Zcash 계정 복원', '還原 Zcash 帳戶'],
  zcashHistoryStart: ['Zcash history start', 'Zcash 내역 시작 지점', 'Zcash 紀錄起點'],
  date: ['Date', '날짜', '日期'],
  blockHeight: ['Block height', '블록 높이', '區塊高度'],
  minimumHeight: ['At least {height}', '{height} 이상', '至少 {height}'],
  birthdayHeight: [
    'Zcash birthday height',
    'Zcash 동기화 시작 블록 높이',
    'Zcash 同步起始區塊高度'
  ],
  recoveryStartDate: ['Recovery start date', '복구 시작일', '復原起始日期'],
  firstTransactionDate: ['First ZEC transaction date', '첫 ZEC 거래 날짜', '第一筆 ZEC 交易日期'],
  selectDate: ['Select date', '날짜 선택', '選擇日期'],
  previousMonth: ['Previous month', '이전 달', '上個月'],
  nextMonth: ['Next month', '다음 달', '下個月'],
  invalidHeight: [
    'Enter a valid Zcash block height.',
    '유효한 Zcash 블록 높이를 입력하세요.',
    '請輸入有效的 Zcash 區塊高度。'
  ],
  heightTooLow: [
    'Block height must be {height} or later.',
    '블록 높이는 {height} 이상이어야 합니다.',
    '區塊高度必須為 {height} 或以上。'
  ],
  missingRecoveryDate: [
    'Select a date before your account’s first transaction.',
    '계정의 첫 거래보다 이전 날짜를 선택하세요.',
    '請選擇早於帳戶第一筆交易的日期。'
  ],
  invalidNetworkHeight: [
    'The Zcash network returned an invalid block height. Please try again.',
    'Zcash 네트워크에서 잘못된 블록 높이를 반환했습니다. 다시 시도하세요.',
    'Zcash 網路回傳無效的區塊高度，請再試一次。'
  ],
  recoveryDateFailed: [
    'Could not look up the recovery date. Please try again.',
    '복구 날짜를 조회하지 못했습니다. 다시 시도하세요.',
    '無法查詢復原日期，請再試一次。'
  ],
  createPassword: ['Create Password', '비밀번호 만들기', '建立密碼'],
  createPasswordDescription: [
    "This password is used to unlock your wallet. We cannot reset this password. If you lose it, you'll need to restore your wallet using your Secret Recovery Phrase.",
    '이 비밀번호는 지갑 잠금을 해제할 때 사용합니다. 비밀번호는 재설정할 수 없습니다. 잊어버리면 복구 문구로 지갑을 복원해야 합니다.',
    '此密碼用來解鎖錢包，我們無法為您重設密碼。若忘記密碼，您需要用秘密助記詞還原錢包。'
  ],
  importPasswordDescription: [
    'Create a password to unlock your wallet. We cannot recover this password.',
    '지갑 잠금을 해제할 비밀번호를 만드세요. 이 비밀번호는 복구할 수 없습니다.',
    '請建立用於解鎖錢包的密碼。我們無法為您找回此密碼。'
  ],
  create: ['Create', '만들기', '建立'],
  password: ['Password', '비밀번호', '密碼'],
  passwordLength: ['{min}–{max} characters', '{min}~{max}자', '{min} 至 {max} 個字元'],
  passwordTooShort: [
    'Password must be at least {min} characters',
    '비밀번호는 {min}자 이상이어야 합니다',
    '密碼至少須包含 {min} 個字元'
  ],
  passwordTooLong: [
    'Password must be no more than {max} characters',
    '비밀번호는 {max}자 이하여야 합니다',
    '密碼最多可包含 {max} 個字元'
  ],
  passwordOnlyWhitespace: [
    'Password cannot contain only whitespace',
    '비밀번호를 공백으로만 구성할 수 없습니다',
    '密碼不可只包含空白字元'
  ],
  passwordInstructions: [
    '* Use {min}–{max} characters. Spaces and symbols are allowed; your password is used exactly as entered.',
    '* {min}~{max}자를 입력하세요. 공백과 기호를 사용할 수 있으며, 입력한 그대로 비밀번호로 사용됩니다.',
    '* 請輸入 {min} 至 {max} 個字元。可使用空格和符號，系統會依照您輸入的內容原樣使用。'
  ],
  confirmPassword: ['Confirm Password', '비밀번호 확인', '確認密碼'],
  confirmPasswordPlaceholder: ['Confirm password', '비밀번호를 다시 입력하세요', '再次輸入密碼'],
  passwordsMismatch: [
    'Passwords do not match',
    '비밀번호가 일치하지 않습니다',
    '兩次輸入的密碼不一致'
  ],
  showPassword: ['Show password', '비밀번호 표시', '顯示密碼'],
  hidePassword: ['Hide password', '비밀번호 숨기기', '隱藏密碼'],
  strengthTooWeak: ['Too Weak', '너무 약함', '太弱'],
  strengthWeak: ['Weak', '약함', '弱'],
  strengthMedium: ['Medium', '보통', '中等'],
  strengthStrong: ['Strong', '강함', '強'],
  agreeToTerms: ['I agree to the {terms}', '{terms}에 동의합니다', '我同意{terms}'],
  termsOfUse: ['Terms of Use', '이용약관', '使用條款'],
  termsRequired: ['Please agree to the Terms of Use', '이용약관에 동의하세요', '請同意使用條款'],
  processing: ['Processing...', '처리 중…', '處理中…'],
  enterPasswordTitle: ['Enter your password', '비밀번호를 입력하세요', '請輸入您的密碼'],
  enterPassword: ['Enter Password', '비밀번호 입력', '輸入密碼'],
  emptyPassword: ['Please enter your password', '비밀번호를 입력하세요', '請輸入您的密碼'],
  unlock: ['Unlock', '잠금 해제', '解鎖'],
  forgotPassword: ['Forgot password?', '비밀번호를 잊으셨나요?', '忘記密碼？'],
  waitForUnlock: [
    'Account locked. Please wait {seconds} seconds.',
    '계정이 잠겼습니다. {seconds}초 동안 기다려 주세요.',
    '帳戶已鎖定，請等待 {seconds} 秒。'
  ],
  tooManyAttempts: [
    'Too many failed attempts. Account temporarily locked.',
    '실패 횟수가 너무 많아 계정이 일시적으로 잠겼습니다.',
    '嘗試失敗次數過多，帳戶已暫時鎖定。'
  ],
  lockCountdown: [
    'Account locked. Try again in {seconds}s',
    '계정이 잠겼습니다. {seconds}초 후에 다시 시도하세요',
    '帳戶已鎖定，請於 {seconds} 秒後重試'
  ],
  lockedButton: ['Locked ({seconds}s)', '잠김({seconds}초)', '已鎖定（{seconds} 秒）'],
  incorrectPassword: ['Incorrect password', '비밀번호가 올바르지 않습니다', '密碼錯誤'],
  incorrectPasswordRetry: [
    'Incorrect password. Please try again.',
    '비밀번호가 올바르지 않습니다. 다시 시도하세요.',
    '密碼錯誤，請再試一次。'
  ],
  invalidPassword: [
    'Invalid password. Please try again.',
    '유효하지 않은 비밀번호입니다. 다시 시도하세요.',
    '密碼無效，請再試一次。'
  ],
  remainingAttempts: [
    'Incorrect password. {count} attempts remaining.',
    '비밀번호가 올바르지 않습니다. 남은 시도 횟수: {count}회.',
    '密碼錯誤，還可嘗試 {count} 次。'
  ],
  missingCredential: [
    'Wallet access data is missing. Restore from your secret phrase.',
    '지갑 접근 데이터가 없습니다. 복구 문구로 복원하세요.',
    '缺少錢包存取資料，請使用助記詞還原。'
  ],
  invalidCredential: [
    'Wallet access data is damaged. Restore from your secret phrase.',
    '지갑 접근 데이터가 손상되었습니다. 복구 문구로 복원하세요.',
    '錢包存取資料已損毀，請使用助記詞還原。'
  ],
  unlockFailed: [
    'Wallet could not be unlocked. Try again.',
    '지갑 잠금을 해제하지 못했습니다. 다시 시도하세요.',
    '無法解鎖錢包，請再試一次。'
  ],
  resetWallet: ['Reset Wallet', '지갑 초기화', '重設錢包'],
  resetRestore: [
    "If you forgot your password, you'll need to reset your wallet using your Secret Recovery Phrase.",
    '비밀번호를 잊었다면 복구 문구로 지갑을 초기화해야 합니다.',
    '如果忘記密碼，您需要使用助記詞重設錢包。'
  ],
  resetRemovesWallet: [
    'This will remove your current wallet from this device.',
    '이 작업을 하면 이 기기에서 현재 지갑이 삭제됩니다.',
    '此操作會從這部裝置移除目前的錢包。'
  ],
  resetWarning: [
    'Make sure you have your Secret Recovery Phrase before proceeding.',
    '계속하기 전에 비밀 복구 문구를 가지고 있는지 확인하세요.',
    '繼續前，請確認您已備妥秘密助記詞。'
  ],
  resetFailed: [
    'Unable to reset wallet. Please try again.',
    '지갑을 초기화하지 못했습니다. 다시 시도하세요.',
    '無法重設錢包，請再試一次。'
  ],
  upgradeFailed: ['Wallet upgrade failed', '지갑 업그레이드 실패', '錢包升級失敗'],
  upgradeLocked: [
    'Noir Wallet could not finish upgrading this wallet. It will stay locked until the upgrade completes.',
    'Noir Wallet이 지갑 업그레이드를 완료하지 못했습니다. 업그레이드가 끝날 때까지 지갑은 잠긴 상태로 유지됩니다.',
    'Noir Wallet 無法完成錢包升級。升級完成前，錢包會保持鎖定。'
  ],
  upgradeAssurance: [
    'Your existing wallet data is still stored on this device. Noir Wallet will not open a partially upgraded wallet.',
    '기존 지갑 데이터는 이 기기에 그대로 보관되어 있습니다. Noir Wallet은 업그레이드가 완료되지 않은 지갑을 열지 않습니다.',
    '現有錢包資料仍保存在這部裝置上。Noir Wallet 不會開啟尚未完成升級的錢包。'
  ],
  connectionFailed: [
    'Network connection failed. Please check your internet and try again.',
    '네트워크에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.',
    '網路連線失敗，請檢查網路連線後再試一次。'
  ],
  timedOut: [
    'Operation timed out. Please try again.',
    '작업 시간이 초과되었습니다. 다시 시도하세요.',
    '操作逾時，請再試一次。'
  ],
  requestTimedOut: ['Request timed out.', '요청 시간이 초과되었습니다.', '請求逾時。'],
  engineError: [
    'Wallet engine error. Please restart the extension.',
    '지갑 엔진에 오류가 발생했습니다. 확장 프로그램을 다시 시작하세요.',
    '錢包引擎發生錯誤，請重新啟動擴充功能。'
  ],
  engineUnresponsive: [
    'Wallet engine is not responding. Please restart the extension.',
    '지갑 엔진이 응답하지 않습니다. 확장 프로그램을 다시 시작하세요.',
    '錢包引擎沒有回應，請重新啟動擴充功能。'
  ],
  engineCrashed: [
    'Wallet engine crashed. Please restart the extension.',
    '지갑 엔진이 중단되었습니다. 확장 프로그램을 다시 시작하세요.',
    '錢包引擎已停止運作，請重新啟動擴充功能。'
  ],
  invalidRecoveryPhrase: [
    'Invalid recovery phrase. Please check and try again.',
    '유효하지 않은 복구 문구입니다. 확인한 후 다시 시도하세요.',
    '助記詞無效，請確認後再試一次。'
  ],
  accountConflict: [
    'Account data conflict. Please re-import your wallet.',
    '계정 데이터가 충돌합니다. 지갑을 다시 가져오세요.',
    '帳戶資料衝突，請重新匯入錢包。'
  ],
  walletLocked: [
    'Wallet is locked. Please unlock and try again.',
    '지갑이 잠겨 있습니다. 잠금을 해제하고 다시 시도하세요.',
    '錢包已鎖定，請解鎖後再試一次。'
  ],
  walletInitializing: [
    'Wallet is initializing. Please wait a moment and try again.',
    '지갑을 초기화하고 있습니다. 잠시 후 다시 시도하세요.',
    '錢包正在初始化，請稍候再試。'
  ],
  walletStateChanged: [
    'Wallet state changed. Please retry the operation.',
    '지갑 상태가 변경되었습니다. 다시 시도하세요.',
    '錢包狀態已變更，請重新操作。'
  ],
  walletNotFound: [
    'Wallet not found. Please create or import a wallet.',
    '지갑을 찾을 수 없습니다. 지갑을 만들거나 가져오세요.',
    '找不到錢包，請建立或匯入錢包。'
  ],
  walletLoadFailed: [
    'Failed to load wallet data. Please try unlocking again.',
    '지갑 데이터를 불러오지 못했습니다. 잠금 해제를 다시 시도하세요.',
    '無法載入錢包資料，請重新解鎖。'
  ],
  walletSaveFailed: [
    'Failed to save wallet data. Please try again.',
    '지갑 데이터를 저장하지 못했습니다. 다시 시도하세요.',
    '無法儲存錢包資料，請再試一次。'
  ]
} as const satisfies MessageCatalog
