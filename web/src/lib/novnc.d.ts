declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, channel: WebSocket, options?: { shared?: boolean })
    scaleViewport: boolean
    resizeSession: boolean
    focusOnClick: boolean
    viewOnly: boolean
    background: string
    disconnect(): void
    focus(options?: FocusOptions): void
    sendCtrlAltDel(): void
    sendKey(keysym: number, code?: string, down?: boolean): void
    clipboardPasteFrom(text: string): void
  }
}
