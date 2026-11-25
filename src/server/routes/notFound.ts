
import type { ErrorCode } from '../../core/types';

export class NotFound extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
