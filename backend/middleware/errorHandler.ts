import { Request, Response, NextFunction } from 'express'

export interface AppError extends Error {
  statusCode?: number
  isOperational?: boolean
}

export const errorHandler = (err: AppError, req: Request, res: Response, _next: NextFunction) => {
  let { statusCode = 500, message } = err

  // Log operational errors without leaking secrets; only 5xx errors include a stack.
  console.error('Error:', {
    message: err.message,
    statusCode,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
    ...(statusCode >= 500 ? { stack: err.stack } : {})
  })

  const errCode = typeof (err as { code?: unknown }).code === 'string' ? String((err as { code?: unknown }).code) : ''
  if (err.name === 'MulterError' || errCode === 'LIMIT_FILE_SIZE') {
    statusCode = errCode === 'LIMIT_FILE_SIZE' ? 413 : 400
    message = errCode === 'LIMIT_FILE_SIZE' ? 'Uploaded file is too large' : message
  }

  if (err.name === 'ValidationError') {
    statusCode = 400
    message = 'Invalid input data'
  }

  // Prisma specific errors
  if (err.name === 'PrismaClientKnownRequestError') {
    statusCode = 400
    message = 'Database operation failed'
  }

  // JWT specific errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401
    message = 'Invalid token'
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401
    message = 'Token expired'
  }

  // Send error response
  const issues = (err as { issues?: unknown }).issues
  res.status(statusCode).json({
    success: false,
    error: {
      message: message || 'Internal server error',
      ...(issues ? { issues } : {}),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    },
    timestamp: new Date().toISOString()
  })
}

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

export const createError = (message: string, statusCode: number = 500): AppError => {
  const error = new Error(message) as AppError
  error.statusCode = statusCode
  error.isOperational = true
  return error
}
