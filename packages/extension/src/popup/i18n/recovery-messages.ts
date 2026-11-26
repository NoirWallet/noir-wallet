import type { MessageCatalog } from './messages'

export const recoveryMessages = {
  backup: ['Back up secret phrase', '복구 문구 백업', '備份助記詞'],
  view: ['View secret phrase', '복구 문구 보기', '查看助記詞'],
  reveal: ['Click to reveal seed phrase', '눌러서 복구 문구 보기', '點擊查看助記詞'],
  walletUnavailable: ['Wallet unavailable.', '지갑을 사용할 수 없습니다.', '錢包無法使用。'],
  sharingRisk: [
    'Sharing your secret phrase may cause you to lose your assets',
    '복구 문구를 공유하면 자산을 잃을 수 있습니다.',
    '分享助記詞可能會導致資產損失。'
  ],
  neverShare: [
    'Never share your Secret Recovery Phrase with anyone. Anyone with this phrase can take your assets forever.',
    '복구 문구는 누구에게도 공유하지 마세요. 복구 문구를 아는 사람은 자산을 가져갈 수 있습니다.',
    '切勿向任何人分享助記詞。任何取得助記詞的人都能轉走你的資產。'
  ],
  passwordLabel: ['Enter Password', '비밀번호 입력', '輸入密碼'],
  passwordPlaceholder: ['Enter your password', '비밀번호를 입력하세요', '請輸入密碼'],
  passwordRequired: ['Please enter your password', '비밀번호를 입력해 주세요.', '請輸入密碼。'],
  incorrectPassword: [
    'Incorrect password. Please try again.',
    '비밀번호가 올바르지 않습니다. 다시 시도해 주세요.',
    '密碼錯誤。請重試。'
  ],
  revealFailed: [
    'Failed to retrieve secret phrase.',
    '복구 문구를 불러오지 못했습니다.',
    '無法載入助記詞。'
  ],
  unlockToReveal: ['Unlock to reveal', '잠금 해제 후 보기', '解鎖並查看'],
  confirmBackup: ['Confirm backup', '백업 확인', '確認備份'],
  prepareBackup: ['Preparing backup check', '백업 확인 준비 중', '準備確認備份'],
  wordNumber: ['Word {number}', '{number}번째 단어', '第 {number} 個單字'],
  wrongWords: [
    'Backup words do not match this wallet. View your secret phrase and try again.',
    '단어가 이 지갑의 복구 문구와 일치하지 않습니다. 복구 문구를 확인하고 다시 시도해 주세요.',
    '備份單字與此錢包不符。請查看助記詞後再試一次。'
  ],
  unlockBeforeBackup: [
    "Unlock and view this wallet's secret phrase before verifying its backup.",
    '백업을 확인하기 전에 지갑을 잠금 해제하고 복구 문구를 확인해 주세요.',
    '請先解鎖錢包並查看助記詞，再驗證備份。'
  ],
  backupCheckFailed: [
    'Could not verify the backup. Try again.',
    '백업을 확인하지 못했습니다. 다시 시도해 주세요.',
    '無法驗證備份。請重試。'
  ],
  continue: ['Continue', '계속', '繼續']
} as const satisfies MessageCatalog
