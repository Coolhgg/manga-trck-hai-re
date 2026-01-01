import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { prisma, withRetry, isTransientError } from "@/lib/prisma"
import { checkRateLimit, validateUsername, handleApiError } from "@/lib/api-utils"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params
    
    // Rate limit: 60 requests per minute per IP for profile views
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(`profile:${ip}`, 60, 60000)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 }
      );
    }

    // Validate username format to prevent injection/path traversal
    if (!validateUsername(username)) {
      return NextResponse.json(
        { error: "Invalid username format" },
        { status: 400 }
      );
    }

    const supabase = await createClient()
    const { data: { user: currentUser } } = await supabase.auth.getUser()

    // Try to get user from database with retry logic and case-insensitivity
    let targetUser = null
    try {
      targetUser = await withRetry(
        () => prisma.user.findFirst({
          where: { 
            username: { 
              equals: username, 
              mode: 'insensitive' 
            } 
          },
          select: {
            id: true,
            username: true,
            avatar_url: true,
            bio: true,
            xp: true,
            level: true,
            streak_days: true,
            created_at: true,
            privacy_settings: true,
          },
        }),
        2,
        200
      )
    } catch (dbError: any) {
      console.warn(`[Profile API] Database error for username ${username}:`, dbError.message?.slice(0, 100))
      
      // If the database is unreachable, try to find the user via Supabase Auth metadata (if they are the current user)
      if (isTransientError(dbError) && currentUser && currentUser.user_metadata?.username?.toLowerCase() === username.toLowerCase()) {
        console.log(`[Profile API] Returning partial data from Supabase for current user ${username}`)
        return NextResponse.json({
          user: {
            id: currentUser.id,
            username: currentUser.user_metadata?.username || username,
            avatar_url: currentUser.user_metadata?.avatar_url || null,
            bio: null,
            xp: 0,
            level: 1,
            streak_days: 0,
            created_at: currentUser.created_at,
            privacy_settings: { library_public: true, activity_public: true },
          },
          stats: {
            libraryCount: 0,
            followersCount: 0,
            followingCount: 0,
          },
          library: [],
          achievements: [],
          isFollowing: false,
          isOwnProfile: true,
          _warning: "Database temporarily unavailable. Showing limited profile information."
        })
      }
      throw dbError
    }

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const isOwnProfile = currentUser?.id === targetUser.id

    // Fetch related data with retry and error handling
    let stats = { libraryCount: 0, followersCount: 0, followingCount: 0 }
    let isFollowing = false
    let library: any[] = []
    let achievements: any[] = []

    try {
      const [libraryCount, followersCount, followingCount, followingRecord] = await withRetry(
        () => Promise.all([
          prisma.libraryEntry.count({ where: { user_id: targetUser.id } }),
          prisma.follow.count({ where: { following_id: targetUser.id } }),
          prisma.follow.count({ where: { follower_id: targetUser.id } }),
          currentUser
            ? prisma.follow.findUnique({
                where: {
                  follower_id_following_id: {
                    follower_id: currentUser.id,
                    following_id: targetUser.id,
                  },
                },
              })
            : Promise.resolve(null),
        ]),
        2,
        150
      )

      stats = { libraryCount, followersCount, followingCount }
      isFollowing = !!followingRecord

      const privacySettings = targetUser.privacy_settings as any || {}
      const isLibraryPublic = privacySettings.library_public !== false

      if (isLibraryPublic || isOwnProfile) {
        library = await withRetry(
          () => prisma.libraryEntry.findMany({
            where: { user_id: targetUser.id, status: "reading" },
            take: 6,
            orderBy: { updated_at: "desc" },
            include: {
              series: {
                select: {
                  id: true,
                  title: true,
                  cover_url: true,
                },
              },
            },
          }),
          2,
          150
        )
      }

      achievements = await withRetry(
        () => prisma.userAchievement.findMany({
          where: { user_id: targetUser.id },
          take: 8,
          orderBy: { unlocked_at: "desc" },
          include: {
            achievement: {
              select: {
                id: true,
                name: true,
                description: true,
                icon_url: true,
                rarity: true,
              },
            },
          },
        }),
        2,
        150
      )
    } catch (relationError: any) {
      console.warn(`[Profile API] Error fetching relations for ${username}:`, relationError.message?.slice(0, 100))
      // Continue with empty arrays if relations fail but user was found
    }

    return NextResponse.json({
      user: targetUser,
      stats,
      library,
      achievements,
      isFollowing,
      isOwnProfile,
    })
  } catch (error: any) {
    return handleApiError(error)
  }
}
