/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string
declare const __BUILD_CHANNEL__: string
declare const __NETWORK_MODE__: string
declare const __ANALYTICS_REPORTING_ENABLED__: boolean
declare const __GA_API_SECRET__: string
declare const __CUSTOM_ANALYTICS_PASSWORD__: string
declare const __DEBUG_LOGS__: boolean
declare const __EXTENSION_UPDATES_ENABLED__: boolean

interface ImportMetaEnv {
  /** Optional build-time cap on the WASM Rayon thread pool (perf/low-power builds). */
  readonly VITE_WASM_THREADS?: string
}

declare module '*.svg' {
  const content: string
  export default content
}

declare module '*.svg?react' {
  import { FC, SVGProps } from 'react'
  const content: FC<SVGProps<SVGElement>>
  export default content
}

declare module '*.webp' {
  const content: string
  export default content
}
