export interface ErrorResponse {
  error_code: string;
  message: string;
  details?: Record<string, unknown>;
  request_id?: string;
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
