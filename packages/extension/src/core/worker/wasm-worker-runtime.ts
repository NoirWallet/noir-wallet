interface WasmWorkerRuntime {
  Window?: unknown
  window?: unknown
  fetch: typeof globalThis.fetch
  setTimeout: typeof globalThis.setTimeout
  clearTimeout: typeof globalThis.clearTimeout
  performance: Performance
}

/**
 * The voting WASM currently asks web-sys for `Window`, while the wallet owns
 * that WASM inside a Dedicated Worker. Let it use the fetch, timer, and
 * performance APIs shared by both contexts without moving wallet state.
 */
export function installWasmWorkerWindowCompatibility(runtime: WasmWorkerRuntime): void {
  if (runtime.window != null) return

  if (
    typeof runtime.fetch !== 'function' ||
    typeof runtime.setTimeout !== 'function' ||
    typeof runtime.clearTimeout !== 'function' ||
    typeof runtime.performance?.now !== 'function'
  ) {
    throw new Error('Voting WASM requires Worker fetch, timers, and performance APIs')
  }

  const wasmFetch: typeof runtime.fetch = (input, init) => runtime.fetch(input, init)
  const wasmSetTimeout = (...args: Parameters<WasmWorkerRuntime['setTimeout']>) =>
    runtime.setTimeout(...args)
  const WasmWorkerWindow = function WasmWorkerWindow() {}
  let compatibilityWindow: object
  // web-sys resolves Window by casting js_sys::global(), which is the Worker global here.
  Object.defineProperty(WasmWorkerWindow, Symbol.hasInstance, {
    value: (candidate: unknown) => candidate === runtime || candidate === compatibilityWindow
  })
  compatibilityWindow = Object.freeze(
    Object.assign(Object.create(WasmWorkerWindow.prototype), {
      fetch: wasmFetch,
      setTimeout: wasmSetTimeout,
      clearTimeout: (handle: number | undefined) => runtime.clearTimeout(handle),
      performance: runtime.performance
    })
  )

  Object.defineProperty(runtime, 'Window', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: WasmWorkerWindow
  })

  Object.defineProperty(runtime, 'window', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: compatibilityWindow
  })
}
