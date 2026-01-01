import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActivityFeed } from "@/lib/social-utils";
import { prisma, withRetry } from "@/lib/prisma";
import { checkRateLimit, validateUsername, parsePaginationParams, handleApiError } from "@/lib/api-utils";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    // Rate limit: 30 requests per minute per IP
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(`activity:${ip}`, 30, 60000)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { username } = await params;

    // Validate username format to prevent injection
    if (!validateUsername(username)) {
      return NextResponse.json(
        { error: "Invalid username format" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const { page, limit } = parsePaginationParams(searchParams);

    // Get user ID from username with case-insensitivity
    const targetUser = await withRetry(
      () => prisma.user.findFirst({
        where: { 
          username: { 
            equals: username, 
            mode: 'insensitive' 
          } 
        },
        select: { id: true },
      }),
      2,
      200
    );

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const feed = await getActivityFeed(targetUser.id, {
      page,
      limit,
      type: "personal",
      viewerId: user?.id,
    });

    return NextResponse.json(feed);
  } catch (error: any) {
    return handleApiError(error);
  }
}
