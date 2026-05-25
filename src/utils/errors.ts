/**
 * Custom error classes for the local task platform API.
 * All errors extend AppError which provides a consistent structure
 * for the global error handler middleware.
 */

export class AppError extends Error {
  statusCode: number;
  error: string; // machine-readable error code
  fields?: Record<string, string>;

  constructor(
    statusCode: number,
    error: string,
    message: string,
    fields?: Record<string, string>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.error = error;
    this.fields = fields;
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): { error: string; message: string; fields?: Record<string, string> } {
    const response: { error: string; message: string; fields?: Record<string, string> } = {
      error: this.error,
      message: this.message,
    };
    if (this.fields) {
      response.fields = this.fields;
    }
    return response;
  }
}

export class ValidationError extends AppError {
  constructor(fields: Record<string, string>) {
    const firstMessage = Object.values(fields)[0] || '入力内容に誤りがあります';
    super(422, 'validation_error', firstMessage, fields);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, 'not_found', message);
  }
}

export class ConflictError extends AppError {
  constructor(error: string, message: string) {
    super(409, error, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(error: string, message: string) {
    super(401, error, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, 'forbidden', message);
  }
}
