import type { ErrorRequestHandler, RequestHandler } from 'express';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'CART_NOT_FOUND'
  | 'ITEM_NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CART_CLOSED'
  | 'ITEM_ALREADY_IN_CART'
  | 'INSUFFICIENT_STOCK'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PRODUCT_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface ErrorDetail {
  field: string;
  issue: string;
}

/** Lỗi nghiệp vụ / xác thực chủ động ném ra từ code của mình. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
  }
}

const MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Request không hợp lệ',
  INVALID_CREDENTIALS: 'Sai username hoặc password',
  UNAUTHORIZED: 'Thiếu hoặc sai access token',
  NOT_FOUND: 'Không tìm thấy đường dẫn',
  CART_NOT_FOUND: 'Không tìm thấy cart',
  ITEM_NOT_FOUND: 'Product không có trong cart',
  METHOD_NOT_ALLOWED: 'Method không được hỗ trợ',
  CART_CLOSED: 'Cart đã checkout, không thể thay đổi',
  ITEM_ALREADY_IN_CART: 'Product đã có trong cart, dùng PATCH để đổi số lượng',
  INSUFFICIENT_STOCK: 'Số lượng vượt tồn kho',
  UNSUPPORTED_MEDIA_TYPE: 'Content-Type không được hỗ trợ',
  PRODUCT_UNAVAILABLE: 'Product không tồn tại hoặc đã ngừng bán',
  INTERNAL_ERROR: 'Lỗi hệ thống, vui lòng thử lại sau',
};

export const errors = {
  cartNotFound: () => new AppError(404, 'CART_NOT_FOUND', MESSAGES.CART_NOT_FOUND),
  itemNotFound: () => new AppError(404, 'ITEM_NOT_FOUND', MESSAGES.ITEM_NOT_FOUND),
  cartClosed: () => new AppError(409, 'CART_CLOSED', MESSAGES.CART_CLOSED),
  itemAlreadyInCart: () => new AppError(409, 'ITEM_ALREADY_IN_CART', MESSAGES.ITEM_ALREADY_IN_CART),
  insufficientStock: () => new AppError(409, 'INSUFFICIENT_STOCK', MESSAGES.INSUFFICIENT_STOCK),
  productUnavailable: () => new AppError(422, 'PRODUCT_UNAVAILABLE', MESSAGES.PRODUCT_UNAVAILABLE),
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', MESSAGES.INVALID_CREDENTIALS),
  unauthorized: () => new AppError(401, 'UNAUTHORIZED', MESSAGES.UNAUTHORIZED),
};

interface ValidatorIssue {
  path?: string;
  message?: string;
}

/** '/body/quantity' -> 'quantity', '/params/cartId' -> 'cartId', '/body' -> 'body'. Mỗi field chỉ giữ lỗi đầu tiên. */
export function toValidationDetails(issues: ValidatorIssue[] | undefined): ErrorDetail[] {
  const byField = new Map<string, string>();
  for (const issue of issues ?? []) {
    const field = (issue.path ?? '').replace(/^\/(body|params|query)\/?/, '') || 'body';
    if (!byField.has(field)) byField.set(field, issue.message ?? 'is invalid');
  }
  return [...byField].map(([field, issue]) => ({ field, issue }));
}

interface NormalizedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
}

/** Đưa MỌI loại lỗi (AppError, validator, body-parser, lỗi bất ngờ) về một dạng. */
export function normalizeError(err: unknown): NormalizedError {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }
  const e = err as { status?: number; type?: string; errors?: ValidatorIssue[] } | undefined;

  if (e?.type === 'entity.parse.failed') {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: MESSAGES.VALIDATION_ERROR,
      details: [{ field: 'body', issue: 'must be valid JSON' }],
    };
  }
  if (e?.type === 'entity.too.large') {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: MESSAGES.VALIDATION_ERROR,
      details: [{ field: 'body', issue: 'is too large' }],
    };
  }

  const byStatus: Record<number, ErrorCode> = {
    400: 'VALIDATION_ERROR',
    401: 'UNAUTHORIZED',
    404: 'NOT_FOUND',
    405: 'METHOD_NOT_ALLOWED',
    415: 'UNSUPPORTED_MEDIA_TYPE',
  };
  const code = e?.status ? byStatus[e.status] : undefined;
  if (code && e?.status) {
    return {
      status: e.status,
      code,
      message: MESSAGES[code],
      details: code === 'VALIDATION_ERROR' ? toValidationDetails(e.errors) : undefined,
    };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: MESSAGES.INTERNAL_ERROR };
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', MESSAGES.NOT_FOUND));
};

/** Error handler duy nhất: không bao giờ lộ stack trace, SQL hay đường dẫn ra response. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const { status, code, message, details } = normalizeError(err);
  if (status >= 500) {
    req.log.error({ err, code }, 'unhandled error');
  } else {
    req.log.warn({ code, details }, message);
  }
  res.status(status).json({
    code,
    message,
    ...(details ? { details } : {}),
    request_id: String(req.id),
  });
};
