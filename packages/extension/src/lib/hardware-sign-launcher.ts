/**
 * Hardware signing uses a durable tab so Web Bluetooth/WebHID chooser UI can
 * attach to a normal browser surface and survive the transient toolbar popup.
 */
export async function launchHardwareSignSurface(url: string): Promise<chrome.tabs.Tab> {
  return chrome.tabs.create({ url })
}
