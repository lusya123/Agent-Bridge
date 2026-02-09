export const ErrorCode = {
  MISSING_AGENT_ID: 'MISSING_AGENT_ID',
  MISSING_FIELDS: 'MISSING_FIELDS',
  NO_ADAPTER: 'NO_ADAPTER',
  ADAPTER_NO_STOP: 'ADAPTER_NO_STOP',
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  MACHINE_NOT_FOUND: 'MACHINE_NOT_FOUND',
  SPAWN_FAILED: 'SPAWN_FAILED',
  STOP_FAILED: 'STOP_FAILED',
  REMOTE_UNREACHABLE: 'REMOTE_UNREACHABLE',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class BridgeError extends Error {
  status: number;
  errorCode: ErrorCodeValue;
  detail?: string;

  constructor(opts: {
    status: number;
    errorCode: ErrorCodeValue;
    message: string;
    detail?: string;
  }) {
    super(opts.message);
    this.name = 'BridgeError';
    this.status = opts.status;
    this.errorCode = opts.errorCode;
    this.detail = opts.detail;
  }
}

export function getErrorDetail(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function errorResponse(
  errorCode: ErrorCodeValue,
  message: string,
  detail?: string,
) {
  return detail
    ? { error_code: errorCode, error: message, detail }
    : { error_code: errorCode, error: message };
}
