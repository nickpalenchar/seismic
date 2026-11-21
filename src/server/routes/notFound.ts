/** A thing a request names that does not exist: the route answers with a 404. */
import type { ErrorCode } from '../../core/types';

export class NotFound extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
