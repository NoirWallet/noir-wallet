import type { MessageCatalog } from './messages'

export const shellMessages = {
  back: ['Back', '뒤로', '返回'],
  close: ['Close', '닫기', '關閉'],
  copy: ['Copy', '복사', '複製'],
  copied: ['Copied', '복사됨', '已複製'],
  copyFailed: ['Could not copy', '복사하지 못했습니다', '無法複製'],
  retry: ['Retry', '다시 시도', '重試'],
  collapseError: ['Collapse error', '오류 메시지 접기', '收合錯誤訊息'],
  expandError: ['Expand error', '오류 메시지 펼치기', '展開錯誤訊息'],
  collapseMessage: ['Collapse message', '메시지 접기', '收合訊息'],
  expandMessage: ['Expand message', '메시지 펼치기', '展開訊息'],
  modalDialog: ['Modal dialog', '대화 상자', '對話框'],
  testnet: ['TESTNET', '테스트넷', '測試網'],
  syncing: ['Syncing', '동기화 중', '同步中'],
  zcashSyncing: ['Zcash Syncing', 'Zcash 동기화 중', 'Zcash 同步中'],
  syncPercentage: [
    'Zcash Syncing · {progress}',
    'Zcash 동기화 중 · {progress}',
    'Zcash 同步中 · {progress}'
  ],
  syncProgress: [
    'Zcash sync progress: {progress}',
    'Zcash 동기화 진행률: {progress}',
    'Zcash 同步進度：{progress}'
  ],
  syncHeight: [
    'Height: {current} / {latest}',
    '블록 높이: {current} / {latest}',
    '區塊高度：{current} / {latest}'
  ],
  syncEta: ['ETA: {time}', '예상 소요 시간: {time}', '預估剩餘時間：{time}'],
  syncFinishing: ['Finishing', '마무리 중', '即將完成'],
  underOneMinute: ['<1 min', '1분 미만', '不到 1 分鐘'],
  approximateMinutes: ['~{minutes} min', '약 {minutes}분', '約 {minutes} 分鐘'],
  approximateHoursMinutes: [
    '~{hours}h {minutes}m',
    '약 {hours}시간 {minutes}분',
    '約 {hours} 小時 {minutes} 分鐘'
  ],
  aboutAvailableBalance: ['About available balance', '사용 가능한 잔액 안내', '關於可用餘額'],
  aboutPendingBalance: ['About pending balance', '확인 대기 중인 잔액 안내', '關於待確認餘額'],
  availableBalanceHelp: [
    'Funds you can use now, before the network fee for this transaction.',
    '이 거래의 네트워크 수수료를 제외하기 전에 사용할 수 있는 자금입니다.',
    '目前可使用的資金，尚未扣除這筆交易的網路手續費。'
  ],
  pendingBalanceHelp: [
    'Funds waiting for enough confirmations before you can use them.',
    '충분한 블록 확인을 기다리는 자금입니다. 확인이 끝나면 사용할 수 있습니다.',
    '等待足夠的區塊確認後即可使用的資金。'
  ],
  walletUnavailable: ['Wallet unavailable', '지갑을 사용할 수 없음', '錢包無法使用'],
  networkStartupFailed: [
    'Noir Wallet could not load its network settings. Close and reopen the wallet to try again.',
    'Noir Wallet이 네트워크 설정을 불러오지 못했습니다. 지갑을 닫았다가 다시 열어 주세요.',
    'Noir Wallet 無法載入網路設定。請關閉並重新開啟錢包。'
  ],
  upgradeFailed: ['Wallet upgrade failed', '지갑 업그레이드 실패', '錢包升級失敗'],
  startupFailed: ['Wallet startup failed', '지갑 시작 실패', '錢包啟動失敗'],
  walletLockedUntilUpgrade: [
    'Noir Wallet could not finish upgrading this wallet. It will stay locked until the upgrade completes.',
    'Noir Wallet이 지갑 업그레이드를 완료하지 못했습니다. 업그레이드가 끝날 때까지 지갑은 잠겨 있습니다.',
    'Noir Wallet 無法完成錢包升級。升級完成前，錢包將保持鎖定。'
  ],
  walletUnavailableUntilStartup: [
    'Noir Wallet could not finish starting. The wallet will remain unavailable until startup succeeds.',
    'Noir Wallet을 시작하지 못했습니다. 시작에 성공할 때까지 지갑을 사용할 수 없습니다.',
    'Noir Wallet 無法完成啟動。成功啟動後才能使用錢包。'
  ],
  upgradeDataRetained: [
    'Your existing wallet data is still stored on this device. Noir Wallet will not open a partially upgraded wallet.',
    '기존 지갑 데이터는 이 기기에 보관되어 있습니다. Noir Wallet은 업그레이드가 완료되지 않은 지갑을 열지 않습니다.',
    '現有錢包資料仍儲存在此裝置。Noir Wallet 不會開啟尚未完成升級的錢包。'
  ],
  startupDataRetained: [
    'Wallet data on this device has not been cleared. Retry to start Noir Wallet again.',
    '이 기기의 지갑 데이터는 삭제되지 않았습니다. Noir Wallet을 다시 시작해 주세요.',
    '此裝置上的錢包資料並未清除。請重試以啟動 Noir Wallet。'
  ],
  sidebar: ['Sidebar', '사이드바', '側邊欄'],
  sidebarMode: ['Side panel mode', '사이드바 모드', '側邊欄模式'],
  displayModeUnchanged: [
    'Display mode unchanged.',
    '표시 모드를 변경하지 못했습니다.',
    '無法變更顯示模式。'
  ],
  phraseBackupReminder: ['Secret phrase backup reminder', '복구 문구 백업 알림', '助記詞備份提醒'],
  backUpPhraseFor: [
    'Back up the secret phrase for {wallet}.',
    '{wallet} 지갑의 복구 문구를 백업하세요.',
    '請備份 {wallet} 的助記詞。'
  ],
  backUp: ['Back up', '백업하기', '備份']
} as const satisfies MessageCatalog
