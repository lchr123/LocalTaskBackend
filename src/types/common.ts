import { Request } from 'express';

export interface PaginatedResponse<T> {
  page: number;
  totalPages: number;
  totalCount?: number;
}

export interface ApiError {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    sub: string;
    email: string;
    phone?: string;
    userId: string;
  };
}
