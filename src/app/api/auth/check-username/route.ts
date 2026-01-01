import { NextRequest, NextResponse } from "next/server"
import { prisma, withRetry, isTransientError } from "@/lib/prisma"
import { checkRateLimit, sanitizeInput, USERNAME_REGEX } from "@/lib/api-utils"

// Reserved usernames that can't be registered
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 
  'help', 'info', 'contact', 'api', 'www', 'mail', 'email',
  'kenmei', 'manga', 'manhwa', 'webtoon', 'moderator', 'mod',
  'settings', 'profile', 'library', 'discover', 'feed',
  'notifications', 'users', 'series', 'leaderboard', 'friends'
])

/**
 * GET /api/auth/check-username
 * Checks if a username is available
 */
export async function GET(request: NextRequest) {
  try {
    // Rate limit: 30 requests per minute per IP
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown"
    if (!checkRateLimit(`check-username:${ip}`, 30, 60000)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 }
      )
    }

    const { searchParams } = new URL(request.url)
    const rawUsername = searchParams.get("username")

    if (!rawUsername) {
      return NextResponse.json({ error: "Username is required" }, { status: 400 })
    }

    // Sanitize and normalize username
    const username = sanitizeInput(rawUsername.toLowerCase(), 30)

    // Validate username format
    if (username.length < 3) {
      return NextResponse.json({ 
        available: false,
        error: "Username must be at least 3 characters" 
      }, { status: 400 })
    }
    
    if (username.length > 20) {
      return NextResponse.json({ 
        available: false,
        error: "Username must be 20 characters or less" 
      }, { status: 400 })
    }

    if (!USERNAME_REGEX.test(username)) {
      return NextResponse.json({ 
        available: false,
        error: "Username can only contain letters, numbers, underscores, and hyphens" 
      }, { status: 400 })
    }

    // Check reserved usernames
    if (RESERVED_USERNAMES.has(username)) {
      return NextResponse.json({ 
        available: false,
        error: "This username is reserved" 
      }, { status: 409 })
    }

    // Check if username exists in database with retry logic
    try {
      const existingUser = await withRetry(
        () => prisma.user.findFirst({
          where: { 
            username: { 
              equals: username, 
              mode: 'insensitive' 
            } 
          },
          select: { id: true }
        }),
        3,  // 3 retries
        150 // 150ms base delay
      )

      if (existingUser) {
        return NextResponse.json({ 
          available: false,
          error: "Username is already taken" 
        }, { status: 409 })
      }

      return NextResponse.json({ available: true })
      
    } catch (dbError: any) {
      // Log the error for debugging
      console.error("Username check database error:", dbError.message || dbError)
      
      // If it's a transient error, return a special response
      // that tells the frontend to allow registration to proceed
      // The actual uniqueness check will happen during user creation
      if (isTransientError(dbError)) {
        return NextResponse.json({ 
          available: true,
          warning: "Could not verify username availability. Please try again or proceed with registration."
        })
      }
      
      // For non-transient errors, return a proper error
      return NextResponse.json({ 
        error: "Failed to check username availability. Please try again." 
      }, { status: 503 })
    }

  } catch (error: any) {
    console.error("Username check error:", error.message || error)
    return NextResponse.json({ 
      error: "An unexpected error occurred. Please try again." 
    }, { status: 500 })
  }
}
