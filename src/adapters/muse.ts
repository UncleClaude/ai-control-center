import type { AdapterSpec } from './types'

/** muse.ai (Meta) — checked 2026-11 on the signed-in UI. */
export const muse: AdapterSpec = {
  name: 'muse',
  assistantMessage: [
    '[data-hatch-assistant-message-body]',
    '.hatch-chat-groupable-bubble:not(.bg-chat-user-bubble)',
  ],
  generating: [
    '[data-hatch-composer-root] button[data-pel-click*="stop" i]',
    '[data-hatch-composer-root] button[aria-label*="Stop" i]',
    '[data-hatch-assistant-message-body][data-streaming="true"]',
    '[data-hatch-message-streaming="true"]',
    '[aria-busy="true"][data-hatch-assistant-message-body]',
  ],
  actionRequired: ['[data-hatch-approval]', '[data-hatch-confirmation]', '[data-pel-click*="approve" i]'],
  // Muse asks questions with answer buttons rendered inside the message (outside the copy area).
  choiceButtons: ['[data-copy-exclude] button'],
  approvalButtonText: /^(approve|allow|confirm|yes|approuver|autoriser|confirmer)$/i,
  composer: ['[data-hatch-composer-root] textarea', '[data-hatch-composer-chrome] textarea', '[data-hatch-composer-root] [contenteditable="true"]'],
  ignorePaths: /^\/(settings|login|signup|legal)/,
}
