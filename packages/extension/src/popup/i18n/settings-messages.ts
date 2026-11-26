import type { MessageCatalog } from './messages'

export const settingsMessages = {
  settings: ['Settings', '설정', '設定'],
  general: ['General', '일반', '一般'],
  addressBook: ['Address Book', '주소록', '通訊錄'],
  dappConnections: ['DApps Connection', '디앱 연결', 'DApp 連線'],
  securityPrivacy: ['Security & Privacy', '보안 및 개인정보 보호', '安全與隱私'],
  networks: ['Networks', '네트워크', '網路'],
  defaultEvmWallet: ['Default EVM Wallet', '기본 EVM 지갑', '預設 EVM 錢包'],
  developerSettings: ['Developer Settings', '개발자 설정', '開發者設定'],
  voting: ['Zcash voting', 'Zcash 투표', 'Zcash 投票'],
  help: ['Help', '도움말', '說明'],
  about: ['About', '정보', '關於'],
  lockWallet: ['Lock Wallet', '지갑 잠그기', '鎖定錢包'],
  autoLock: ['Auto-lock Timer', '자동 잠금 시간', '自動鎖定時間'],
  theme: ['Theme (Coming soon)', '테마 (출시 예정)', '主題（即將推出）'],
  light: ['Light', '라이트', '淺色'],
  dark: ['Dark', '다크', '深色'],
  system: ['System', '시스템', '跟隨系統'],
  language: ['Language', '언어', '語言'],
  followBrowser: ['Follow browser', '브라우저 언어 사용', '跟隨瀏覽器'],
  languageSaveFailed: [
    'Could not change the language. Try again.',
    '언어를 변경하지 못했습니다. 다시 시도해 주세요.',
    '無法變更語言。請重試。'
  ]
} as const satisfies MessageCatalog
