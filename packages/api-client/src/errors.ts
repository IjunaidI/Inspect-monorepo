/**
 * Thrown by every client method on a non-2xx response.
 *
 * Carries the HTTP status because callers branch on it and that branching is
 * load-bearing across the product: 404 (unknown invite) vs 410 (consumed) drive
 * different screens, and the filled-slot 409 is what tells populate to offer a
 * retake instead of a second upload.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
