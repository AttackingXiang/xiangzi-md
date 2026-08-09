export type DraftRecoveryResult =
  | { kind: 'recovered'; tabId: string }
  | { kind: 'blocked'; tabId: string; reason: 'dirty-existing-path' }
