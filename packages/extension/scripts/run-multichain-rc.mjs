import { spawn } from 'node:child_process'
import process from 'node:process'

const steps = [
  { name: 'Logic regression', args: ['run', 'test:logic'] },
  { name: 'Zcash MV3 and V1 Golden regression', args: ['run', 'test:extension'] },
  { name: 'Default multichain release surface', args: ['run', 'test:release:default'] },
  {
    name: 'Zcash testnet environment and wallet provisioning',
    args: ['run', 'test:transactions:testnet']
  },
  { name: 'Multichain Receive and Networks', args: ['run', 'test:multichain:receive:testnet'] },
  { name: 'Private-key Wallet testnet import and export', args: ['run', 'test:private-key:testnet'] },
  {
    name: 'EVM testnet send, signing, provider, Activity, and lifecycle',
    args: ['run', 'test:evm:testnet'],
    env: { APPROVAL_WINDOW_E2E: '1' }
  },
  {
    name: 'Bitcoin testnet send, signing, provider, Activity, and lifecycle',
    args: ['run', 'test:bitcoin:testnet'],
    env: { APPROVAL_WINDOW_E2E: '1' }
  },
  { name: 'Swap and Lending multichain protocol flow', args: ['run', 'test:protocol:mainnet'] },
  {
    name: 'Mainnet production build',
    args: ['run', 'build'],
    env: {
      BUILD_CHANNEL: 'production',
      EVM_HISTORY_API_ORIGIN: 'https://evm-history.test'
    }
  },
  {
    name: 'Testnet production build',
    args: ['run', 'build:testnet'],
    env: {
      BUILD_CHANNEL: 'production',
      EVM_HISTORY_API_ORIGIN: 'https://evm-history.test'
    }
  },
  { name: 'Current screenshot catalog', args: ['run', 'screenshots:check'] }
]

function runStep(step, index) {
  return new Promise((resolve, reject) => {
    console.log(`\n[${index + 1}/${steps.length}] ${step.name}`)
    const child = spawn('pnpm', step.args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        E2E_SCREENSHOTS: '1',
        ...step.env
      },
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `${step.name} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`
        )
      )
    })
  })
}

const startedAt = Date.now()
for (const [index, step] of steps.entries()) {
  await runStep(step, index)
}

console.log(`\nMultichain RC regression passed in ${Math.round((Date.now() - startedAt) / 1000)}s`)
