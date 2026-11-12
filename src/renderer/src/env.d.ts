/// <reference types="vite/client" />
import type { ShellApi } from '../../shared/protocol'

declare global {
  interface Window {
    aicc: ShellApi
  }
}
