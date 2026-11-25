import { ERRORS, type ErrorCode } from './error-text'

export { errorMessage, type ErrorCode } from './error-text'

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number

  constructor(code: ErrorCode, message?: string) {
    super(message ?? ERRORS[code][1])
    this.name = 'AppError'
    this.code = code
    this.status = ERRORS[code][0]
  }
}
