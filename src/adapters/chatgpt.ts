import type { AdapterSpec } from './types'

/** chatgpt.com — checked 2026-11 on the signed-in UI. */
export const chatgpt: AdapterSpec = {
  name: 'chatgpt',
  assistantMessage: ['[data-conversation-role="assistant"]', '[data-message-author-role="assistant"]'],
  generating: [
    '[data-conversation-role="assistant"][data-talvt-turn-state]:not([data-talvt-turn-state="complete"])',
    '[data-talvt-turn-state="streaming"]',
    'button[data-testid="stop-button"]',
    '[data-composer-surface-overflow] button[aria-label*="Stop" i]',
    '.result-streaming',
  ],
  actionRequired: [
    '[data-testid*="confirm" i] button',
    '[data-testid*="approval" i]',
    '[data-agent-takeover]',
  ],
  approvalButtonText: /^(confirm|approve|allow|continue|take over|confirmer|approuver|autoriser|continuer|prendre le contrôle)$/i,
  composer: ['[data-composer-surface-overflow] .ProseMirror', '#prompt-textarea', 'form [contenteditable="true"]'],
  ignorePaths: /^\/(auth|settings|gpts|codex|library|images)/,
}
