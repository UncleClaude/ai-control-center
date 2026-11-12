import type { AdapterSpec } from './types'

/** claude.ai — checked 2026-11 on the signed-in UI. */
export const claude: AdapterSpec = {
  name: 'claude',
  assistantMessage: ['[data-testid="assistant-message"]', '.font-claude-response', '[data-is-streaming]'],
  generating: [
    '[data-is-streaming="true"]',
    '[data-perf-row-streaming="true"]',
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop response"]',
    'fieldset button[aria-label*="Stop" i]',
  ],
  actionRequired: [
    '[data-testid*="permission" i] button',
    '[data-testid*="approval" i] button',
    '[data-testid*="tool-approval" i]',
  ],
  approvalButtonText: /^(allow|allow once|always allow|approve|confirm|continue|autoriser|approuver|confirmer)$/i,
  composer: ['[data-testid="chat-input"]', 'div.ProseMirror[contenteditable="true"]', 'fieldset [contenteditable="true"]'],
  ignorePaths: /^\/(settings|login|logout|upgrade|download)/,
}
