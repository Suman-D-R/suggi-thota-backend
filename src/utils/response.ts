// Response utility for consistent API responses
import { Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  errors?: string[];
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
  [key: string]: any; // Allow additional fields
}

// Success response
export const successResponse = <T = any>(
  res: Response,
  message: string,
  data?: T,
  statusCode: number = 200,
  meta?: ApiResponse['meta']
): Response<ApiResponse<T>> => {
  const response: ApiResponse<T> = {
    success: true,
    message,
    ...(data !== undefined && { data }),
    ...(meta && { meta }),
  };

  return res.status(statusCode).json(response);
};

// Error response
export const errorResponse = (
  res: Response,
  message: string,
  statusCode: number = 500,
  error?: string,
  errors?: string[]
): Response<ApiResponse> => {
  const response: ApiResponse = {
    success: false,
    message,
    ...(error && { error }),
    ...(errors && { errors }),
  };

  return res.status(statusCode).json(response);
};

// Validation error response
export const validationErrorResponse = (
  res: Response,
  errors: string[]
): Response<ApiResponse> => {
  return errorResponse(res, 'Validation failed', 400, undefined, errors);
};

// Not found response
export const notFoundResponse = (
  res: Response,
  message: string = 'Resource not found'
): Response<ApiResponse> => {
  return errorResponse(res, message, 404);
};

// Unauthorized response
export const unauthorizedResponse = (
  res: Response,
  message: string = 'Unauthorized access'
): Response<ApiResponse> => {
  return errorResponse(res, message, 401);
};

// Forbidden response
export const forbiddenResponse = (
  res: Response,
  message: string = 'Access forbidden'
): Response<ApiResponse> => {
  return errorResponse(res, message, 403);
};

// Bad request response
export const badRequestResponse = (
  res: Response,
  message: string = 'Bad request',
  additionalData?: Record<string, any>
): Response<ApiResponse> => {
  const response: ApiResponse = {
    success: false,
    message,
    ...(additionalData && additionalData),
  };

  return res.status(400).json(response);
};

// Conflict response
export const conflictResponse = (
  res: Response,
  message: string = 'Resource conflict'
): Response<ApiResponse> => {
  return errorResponse(res, message, 409);
};

// Internal server error response
export const internalServerErrorResponse = (
  res: Response,
  message: string = 'Internal server error'
): Response<ApiResponse> => {
  return errorResponse(res, message, 500);
};

// Paginated response
export const paginatedResponse = <T = any>(
  res: Response,
  message: string,
  data: T[],
  page: number,
  limit: number,
  total: number,
  statusCode: number = 200
): Response<ApiResponse<T[]>> => {
  const totalPages = Math.ceil(total / limit);
  const meta = {
    page,
    limit,
    total,
    totalPages,
  };
  return successResponse(res, message, data, statusCode, meta);
};

// Created response
export const createdResponse = <T = any>(
  res: Response,
  message: string,
  data?: T
): Response<ApiResponse<T>> => {
  return successResponse(res, message, data, 201);
};

// No content response
export const noContentResponse = (res: Response): Response => {
  return res.status(204).send();
};

// Legacy function for backward compatibility
export const sendResponse = (res: Response, statusCode: number, data: any, message?: string) => {
  if (statusCode >= 200 && statusCode < 300) {
    return successResponse(res, message || 'Success', data, statusCode);
  } else {
    return errorResponse(res, message || 'Error', statusCode, undefined, Array.isArray(data) ? data : undefined);
  }
};

// Response utility functions object
export const responseUtils = {
  successResponse,
  errorResponse,
  validationErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
  badRequestResponse,
  conflictResponse,
  internalServerErrorResponse,
  paginatedResponse,
  createdResponse,
  noContentResponse,
  sendResponse,
};

