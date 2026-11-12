import type { AdapterSpec } from './types'

/** chatgpt.com — checked 2026-11 on the signed-in UI. */
export const chatgpt: AdapterSpec = {
  name: 'chatgpt',
  // data-conversation-role="assistant" sits on a screen-reader <h4> ("ChatGPT said:"); the answer
  // itself is the markdown block next to it.
  assistantMessage: [
    '[data-markdown-text-style="assistant-message"]',
    '[data-message-author-role="assistant"]',
    '[data-conversation-role="assistant"]',
  ],
  messageText: ['[data-markdown-copy="contents"]', '.markdown'],
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
