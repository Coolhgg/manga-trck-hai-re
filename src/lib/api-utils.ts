import { NextResponse } from 'next/server'

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const ErrorCodes = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export function handleApiError(error: unknown): NextResponse {
  if (process.env.NODE_ENV !== 'test') {
    console.error('[API Error]:', error)
  }

  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode }
    )
  }

  if (error instanceof Error) {
    const lowerMessage = error.message.toLowerCase()
    
    if (lowerMessage.includes('not found')) {
      return NextResponse.json(
        { error: error.message, code: ErrorCodes.NOT_FOUND },
        { status: 404 }
      )
    }
    if (lowerMessage.includes('unauthorized')) {
      return NextResponse.json(
        { error: error.message, code: ErrorCodes.UNAUTHORIZED },
        { status: 401 }
      )
    }
    if (lowerMessage.includes('forbidden') || lowerMessage.includes('private')) {
      return NextResponse.json(
        { error: error.message, code: ErrorCodes.FORBIDDEN },
        { status: 403 }
      )
    }
    if (error.name === 'PrismaClientKnownRequestError') {
      const prismaError = error as any
      if (prismaError.code === 'P2002') {
        return NextResponse.json(
          { error: 'Resource already exists', code: ErrorCodes.CONFLICT },
          { status: 409 }
        )
      }
      if (prismaError.code === 'P2025') {
        return NextResponse.json(
          { error: 'Resource not found', code: ErrorCodes.NOT_FOUND },
          { status: 404 }
        )
      }
      if (prismaError.code === 'P2003') {
        return NextResponse.json(
          { error: 'Foreign key constraint failed', code: ErrorCodes.BAD_REQUEST },
          { status: 400 }
        )
      }
      if (prismaError.code === 'P2014') {
        return NextResponse.json(
          { error: 'The change you are trying to make would violate the required relation', code: ErrorCodes.BAD_REQUEST },
          { status: 400 }
        )
      }
    }
  }

  // Final fallback for all other errors (including generic Errors)
  const isProd = process.env.NODE_ENV === 'production'
  const errorId = Math.random().toString(36).substring(2, 10).toUpperCase()
  
  if (isProd) {
    console.error(`[Error ID: ${errorId}]`, error)
  }

  const message = isProd 
    ? `An internal server error occurred (Error ID: ${errorId})` 
    : error instanceof Error ? error.message : 'An unexpected error occurred'
  
  return NextResponse.json(
    { error: message, code: ErrorCodes.INTERNAL_ERROR, errorId: isProd ? errorId : undefined },
    { status: 500 }
  )
}

export function validateRequired(
  data: Record<string, unknown>,
  fields: string[]
): void {
  const missing = fields.filter((field) => !data[field])
  if (missing.length > 0) {
    throw new ApiError(`Missing required fields: ${missing.join(', ')}`, 400, 'MISSING_FIELDS')
  }
}

export function validateUUID(id: string, fieldName = 'id'): void {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(id)) {
    throw new ApiError(`Invalid ${fieldName} format`, 400, 'INVALID_FORMAT')
  }
}

/**
 * Sanitizes user input to prevent XSS attacks
 * Removes HTML tags and dangerous patterns
 */
export function sanitizeInput(input: string, maxLength = 10000): string {
  if (!input) return ''
  
  const sanitized = input
    // Remove encoded characters that might be used for bypasses (do this early)
    .replace(/&#x?[0-9a-f]+;?/gi, '')
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove dangerous protocols and patterns
    .replace(/(javascript|data|vbscript|file|about|blob)\s*:/gi, '')
    // Remove event handlers and dangerous attributes
    .replace(/\b(on\w+|style|formaction|action)\s*=/gi, '')
    .trim()
  
  return sanitized.slice(0, maxLength)
}

/**
 * HTML encode special characters for safe display
 */
export function htmlEncode(input: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  }
  return input.replace(/[&<>"'/]/g, (char) => entities[char] || char)
}

/**
 * Sanitizes text for bio fields etc - just trims and limits length
 */
export function sanitizeText(input: string, maxLength = 500): string {
  if (!input) return ''
  return input.trim().slice(0, maxLength)
}

export function parsePaginationParams(
  searchParams: URLSearchParams
): { page: number; limit: number; offset: number } {
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
  const providedOffset = searchParams.get('offset')
  const providedPage = searchParams.get('page')
  
  let offset: number
  let page: number
  
  if (providedOffset !== null) {
    offset = Math.max(0, parseInt(providedOffset, 10))
    page = Math.floor(offset / limit) + 1
  } else {
    page = Math.max(1, parseInt(providedPage || '1', 10))
    offset = (page - 1) * limit
  }
  
  return { page, limit, offset }
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,30}$/

export function validateUsername(username: string): boolean {
  return USERNAME_REGEX.test(username)
}

/**
 * SECURITY: Escape ILIKE special characters to prevent SQL injection
 * Characters %, _, and \ have special meaning in ILIKE patterns
 */
export function escapeILikePattern(input: string): string {
  return input
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/%/g, '\\%')    // Escape percent signs
    .replace(/_/g, '\\_')    // Escape underscores
}

// Rate limiting with automatic cleanup
interface RateLimitEntry {
  count: number
  resetTime: number
}

class RateLimitStore {
  private map = new Map<string, RateLimitEntry>()
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    // Cleanup stale entries every 5 minutes
    if (typeof setInterval !== 'undefined') {
      this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000)
      // Ensure the interval doesn't keep the process alive in Node.js
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref()
      }
    }
  }

  get(key: string): RateLimitEntry | undefined {
    return this.map.get(key)
  }

  set(key: string, entry: RateLimitEntry): void {
    this.map.set(key, entry)
  }

  delete(key: string): void {
    this.map.delete(key)
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.map.entries()) {
      if (now > entry.resetTime) {
        this.map.delete(key)
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.map.clear()
  }
}

// Use a global to persist the store across HMR in development
const globalForRateLimit = global as unknown as { rateLimitStore: RateLimitStore }
const rateLimitStore = globalForRateLimit.rateLimitStore || new RateLimitStore()

if (process.env.NODE_ENV !== 'production') {
  globalForRateLimit.rateLimitStore = rateLimitStore
}


export function checkRateLimit(
  key: string,
  maxRequests: number = 100,
  windowMs: number = 60000
): boolean {
  const now = Date.now()
  const record = rateLimitStore.get(key)

  if (!record || now > record.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs })
    return true
  }

  if (record.count >= maxRequests) {
    return false
  }

  record.count++
  return true
}

export function clearRateLimit(key: string): void {
  rateLimitStore.delete(key)
}

/**
 * Auth-specific rate limiting (stricter limits)
 */
export function checkAuthRateLimit(ip: string): boolean {
  // 5 attempts per minute for auth endpoints
  return checkRateLimit(`auth:${ip}`, 5, 60000)
}

/**
 * Validates the Origin header against the request URL's host to prevent CSRF
 * Simple check for Route Handlers
 */
export function validateOrigin(request: Request) {
  // Skip CSRF origin check in development to avoid issues with varying sandbox origins
  if (process.env.NODE_ENV === 'development') return;

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        throw new ApiError("CSRF Protection: Invalid origin", 403, ErrorCodes.FORBIDDEN);
      }
    } catch {
      // If the origin is present but not a valid URL, it's safer to block in production
      // but we allow it in development (already handled by the top check)
      throw new ApiError("CSRF Protection: Invalid origin format", 403, ErrorCodes.FORBIDDEN);
    }
  }
}

export async function withErrorHandling<T>(
  handler: () => Promise<T>
): Promise<NextResponse> {
  try {
    const result = await handler()
    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error)
  }
}
