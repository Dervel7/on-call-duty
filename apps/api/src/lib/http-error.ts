export class HttpError extends Error {
  readonly status: number
  /** Sent as the `Retry-After` header; set it on 429 responses. */
  readonly retryAfterSeconds?: number

  constructor(status: number, message: string, retryAfterSeconds?: number) {
    super(message)
    this.status = status
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds
    this.name = 'HttpError'
  }
}
