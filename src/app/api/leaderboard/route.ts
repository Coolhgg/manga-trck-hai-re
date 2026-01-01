import { NextRequest, NextResponse } from "next/server"
import { prisma, withRetry, isTransientError } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/api-utils"

const VALID_CATEGORIES = ['xp', 'streak', 'chapters'] as const
const VALID_PERIODS = ['week', 'month', 'all-time'] as const

export async function GET(request: NextRequest) {
  // Rate limit: 30 requests per minute per IP
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown"
  if (!checkRateLimit(`leaderboard:${ip}`, 30, 60000)) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429 }
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get("period") || "all-time"
    const category = searchParams.get("category") || "xp"
    const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "50")), 100)

    // Validate category
    if (!VALID_CATEGORIES.includes(category as any)) {
      return NextResponse.json(
        { error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate period
    if (!VALID_PERIODS.includes(period as any)) {
      return NextResponse.json(
        { error: `Invalid period. Must be one of: ${VALID_PERIODS.join(', ')}` },
        { status: 400 }
      )
    }

    let orderBy: any = { xp: "desc" }
    const selectFields: any = {
      id: true,
      username: true,
      avatar_url: true,
      xp: true,
      level: true,
      streak_days: true,
      chapters_read: true,
    }
    
    if (category === "streak") {
      orderBy = { streak_days: "desc" }
    } else if (category === "chapters") {
      orderBy = { chapters_read: "desc" }
    }

    const where: any = {}
    
    // Filter out users with no activity in the category
    if (category === "streak") {
      where.streak_days = { gt: 0 }
    } else if (category === "chapters") {
      where.chapters_read = { gt: 0 }
    } else {
      where.xp = { gt: 0 }
    }
    
    const users = await withRetry(
      () => prisma.user.findMany({
        select: selectFields,
        orderBy,
        take: limit,
        where,
      }),
      3,
      200
    )

    // Add rank to each user
    const rankedUsers = users.map((user, index) => ({
      rank: index + 1,
      ...user,
    }))

    return NextResponse.json({ 
      users: rankedUsers,
      category,
      period,
      total: rankedUsers.length,
    })
  } catch (error: any) {
    console.error('Leaderboard error:', error)
    
    if (isTransientError(error)) {
      return NextResponse.json(
        { 
          error: 'Database temporarily unavailable',
          users: [],
          category: 'xp',
          period: 'all-time',
          total: 0
        },
        { status: 503 }
      )
    }
    
    return NextResponse.json(
      { error: 'Failed to fetch leaderboard' },
      { status: 500 }
    )
  }
}
