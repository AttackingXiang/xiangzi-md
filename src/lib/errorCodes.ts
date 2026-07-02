export const ErrorCode = {
  FILE_CONFLICT: 'file_conflict',
  SETTINGS_READ_ONLY: 'settings_read_only',
  FILE_TOO_LARGE: 'file_too_large',
  ALREADY_EXISTS: 'already_exists',
  INVALID_NAME: 'invalid_name',
  TRASH_FAILED: 'trash_failed',
} as const satisfies Record<string, string>

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]
