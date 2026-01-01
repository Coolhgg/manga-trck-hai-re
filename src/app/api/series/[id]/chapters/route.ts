import { prisma, withRetry } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit } from "@/lib/api-utils"

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limit: 60 requests per minute per IP
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown"
    if (!checkRateLimit(`chapters:${ip}`, 60, 60000)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 }
      )
    }

    const { id } = await params

    // Validate UUID format to prevent injection
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json(
        { error: "Invalid series ID format" },
        { status: 400 }
      )
    }

    const chapters = await withRetry(() => 
      prisma.chapter.findMany({
        where: { series_id: id },
        orderBy: { chapter_number: "desc" },
        select: {
          id: true,
          chapter_number: true,
          chapter_title: true,
          chapter_url: true,
          published_at: true,
          source: {
            select: {
              source_name: true,
            },
          },
        },
      })
    )

    return NextResponse.json({
      chapters: chapters.map((c) => ({
        id: c.id,
        chapter_number: Number(c.chapter_number),
        chapter_title: c.chapter_title,
        chapter_url: c.chapter_url,
        published_at: c.published_at?.toISOString() || null,
        source: c.source?.source_name,
      })),
      total: chapters.length,
    })
  } catch (error: any) {
    console.error("Failed to fetch chapters:", error)
    
    // Handle specific Prisma errors
    if (error.code === 'P2023') {
      return NextResponse.json(
        { error: "Invalid series ID format" },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: "Failed to fetch chapters" },
      { status: 500 }
    )
  }
}
