/**
 * A site adapter describes, with CSS selectors only, how to read one AI's page. Every list is
 * tried in order: the first entry is the current selector, the next ones are fallbacks for older or
 * A/B-tested versions of the UI. When a site changes, this is the only file to update.
 */
export interface AdapterSpec {
  name: string
  /** One assistant message (the last match is the latest message). */
  assistantMessage: string[]
  /** Present only while a response or agent run is in progress (stop button, streaming flag). */
  generating: string[]
  /**
   * Present when the AI waits for the user: approval / permission cards, confirmation prompts.
   * Matched anywhere in the page.
   */
  actionRequired: string[]
  /**
   * Inside the last assistant message: interactive choices offered to the user (e.g. Muse's answer
   * buttons). Two or more means "needs you".
   */
  choiceButtons?: string[]
  /** Text of buttons that mean an approval is requested (matched on visible buttons). */
  approvalButtonText?: RegExp
  /** The message input: used as a health check that the adapter still recognises the page. */
  composer: string[]
  /** Paths where a composer is not expected (settings pages...), skipped by the health check. */
  ignorePaths?: RegExp
}

export type AdapterEventKind = 'generating' | 'done' | 'needs-input'

export interface AdapterEvent {
  kind: AdapterEventKind
  /** Short excerpt of the latest assistant message (no more than ~160 chars). */
  snippet: string
  /** Identifies the response, to de-duplicate with the site's own notifications. */
  key: string
  url: string
}
