import { createError } from '../middleware/errorHandler'

export interface ValidationIssue {
  field: string
  message: string
}

export class ValidationError extends Error {
  statusCode = 400
  isOperational = true
  issues: ValidationIssue[]

  constructor(issues: ValidationIssue[]) {
    super('Invalid input data')
    this.name = 'ValidationError'
    this.issues = issues
  }
}

export function failValidation(field: string, message: string): never {
  throw new ValidationError([{ field, message }])
}

export function requiredString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    failValidation(field, `${field} is required`)
  }
  const trimmed = value.trim()
  if (trimmed.length > maxLength) failValidation(field, `${field} is too long`)
  return trimmed
}

export function optionalString(value: unknown, field: string, maxLength = 500): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') failValidation(field, `${field} must be a string`)
  if (value.trim().length > maxLength) failValidation(field, `${field} is too long`)
  return value.trim()
}

export function numberValue(value: unknown, field: string, options: { required?: boolean; min?: number; max?: number } = {}): number | undefined {
  if (value === undefined || value === null || value === '') {
    if (options.required) failValidation(field, `${field} is required`)
    return undefined
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) failValidation(field, `${field} must be a number`)
  if (options.min !== undefined && parsed < options.min) failValidation(field, `${field} is below the minimum`)
  if (options.max !== undefined && parsed > options.max) failValidation(field, `${field} is above the maximum`)
  return parsed
}

export function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[], fallback?: T): T {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback
    failValidation(field, `${field} is required`)
  }
  if (!allowed.includes(value as T)) failValidation(field, `${field} must be one of: ${allowed.join(', ')}`)
  return value as T
}

export function dateValue(value: unknown, field: string, required = false): Date | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) failValidation(field, `${field} is required`)
    return undefined
  }
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) failValidation(field, `${field} must be a valid date`)
  return date
}

export function booleanValue(value: unknown, field: string, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  failValidation(field, `${field} must be a boolean`)
}

export function pagination(query: Record<string, unknown>): { page: number; limit: number; skip: number } {
  const page = numberValue(query.page, 'page', { min: 1 }) ?? 1
  const limit = Math.min(numberValue(query.limit, 'limit', { min: 1 }) ?? 20, 100)
  return { page, limit, skip: (page - 1) * limit }
}

export function assertFound<T>(value: T | null, entity: string): T {
  if (!value) throw createError(`${entity} not found`, 404)
  return value
}
