import type { AdapterSpec } from './types'

/**
 * Fallback for AIs added to ais.json without a dedicated adapter: common stop-button patterns.
 * Such sites still get their own web notifications relayed.
 */
export const generic: AdapterSpec = {
  name: 'generic',
  assistantMessage: ['[data-message-author-role="assistant"]', '[data-role="assistant"]', '[data-testid*="assistant" i]'],
  generating: ['button[data-testid="stop-button"]', 'button[aria-label^="Stop" i]', '[data-is-streaming="true"]', '[aria-busy="true"]'],
  actionRequired: [],
  composer: ['textarea', '[contenteditable="true"]'],
}
