import type { MessageCatalog } from './messages'

export const pickerMessages = {
  selectToken: ['Select Token', '토큰 선택', '選擇代幣'],
  chooseAsset: ['Choose an asset', '자산을 선택하세요', '選擇資產'],
  searchTokens: ['Search tokens', '토큰 검색', '搜尋代幣'],
  noTokens: ['No tokens found', '토큰이 없습니다', '找不到代幣'],
  loadTokens: ['Loading tokens', '토큰 불러오는 중', '正在載入代幣'],
  filterNetworks: ['Filter assets by network', '네트워크별 자산 필터링', '按網路篩選資產'],
  all: ['All', '전체', '全部'],
  allNetworks: ['All networks', '모든 네트워크', '所有網路'],
  moreNetworks: ['More networks', '네트워크 더 보기', '更多網路'],
  selectedNetwork: ['Selected network', '선택한 네트워크', '已選擇的網路'],
  showFewer: ['Show fewer assets', '자산 접기', '顯示較少資產'],
  showMore: ['Show more assets', '자산 더 보기', '顯示更多資產'],
  verifying: ['Verifying token...', '토큰 확인 중…', '正在驗證代幣…'],
  chooseEvm: [
    'Select an EVM network to find this token',
    '이 토큰을 찾으려면 EVM 네트워크를 선택하세요',
    '選擇 EVM 網路即可搜尋此代幣'
  ],
  verifyFailed: [
    'Token could not be verified on this network',
    '이 네트워크에서 토큰을 확인하지 못했습니다',
    '無法在此網路驗證代幣'
  ],
  addFailed: ['Could not add token', '토큰을 추가하지 못했습니다', '無法新增代幣'],
  added: ['Added to wallet', '지갑에 추가되었습니다', '已新增至錢包'],
  add: ['Add', '추가', '新增'],
  adding: ['Adding', '추가 중', '新增中'],
  addingToken: ['Adding token', '토큰 추가 중', '正在新增代幣'],
  addToWallet: [
    'Add {symbol} on {network} to wallet',
    '{network}의 {symbol}을 지갑에 추가',
    '將 {network} 上的 {symbol} 新增至錢包'
  ],
  addingToWallet: [
    'Adding {symbol} on {network} to wallet',
    '{network}의 {symbol}을 지갑에 추가하는 중',
    '正在將 {network} 上的 {symbol} 新增至錢包'
  ],
  selectNetwork: ['Select Network', '네트워크 선택', '選擇網路'],
  chooseNetwork: ['Choose a network', '네트워크를 선택하세요', '選擇網路'],
  searchNetwork: ['Search network', '네트워크 검색', '搜尋網路'],
  searchNetworks: ['Search networks', '네트워크 검색', '搜尋網路'],
  switchingNetwork: ['Switching network', '네트워크 전환 중', '正在切換網路'],
  loadingNetworks: ['Loading networks…', '네트워크 불러오는 중…', '正在載入網路…'],
  noNetworks: ['No networks found', '네트워크가 없습니다', '找不到網路']
} as const satisfies MessageCatalog
