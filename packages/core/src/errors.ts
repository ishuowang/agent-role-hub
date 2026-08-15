export type RoleHubErrorCode =
  | 'BUNDLE_CHANGED'
  | 'BUNDLE_NOT_FOUND'
  | 'BUNDLE_TOO_LARGE'
  | 'CAPABILITY_CONFLICT'
  | 'DUPLICATE_SKILL'
  | 'EMPTY_PROMPT'
  | 'EXPECTED_ONE_ROLE'
  | 'INVALID_ROLE_ID'
  | 'INVALID_SKILL'
  | 'INVALID_YAML'
  | 'MANIFEST_NOT_FOUND'
  | 'MISSING_FILE'
  | 'OUTPUT_NOT_EMPTY'
  | 'PATH_NOT_FOUND'
  | 'POLICY_INVALID'
  | 'POLICY_MISMATCH'
  | 'SCHEMA_INVALID'
  | 'SECRET_DETECTED'
  | 'UNKNOWN_COMPATIBILITY'
  | 'UNSAFE_BUNDLE'
  | 'UNSAFE_PATH'

export class RoleHubError extends Error {
  readonly code: RoleHubErrorCode

  constructor(code: RoleHubErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RoleHubError'
    this.code = code
  }
}
