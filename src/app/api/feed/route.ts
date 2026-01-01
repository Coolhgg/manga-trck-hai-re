import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActivityFeed } from "@/lib/social-utils";
import { checkRateLimit, handleApiError } from "@/lib/api-utils";

const VALID_TYPES = ['global', 'following'] as const;

export async function GET(request: Request) {
  try {
    // Rate limit
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(`feed:${ip}`, 60, 60000)) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a moment.' },
        { status: 429 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "20")), 50);
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0"));
    const actualPage = offset > 0 ? Math.floor(offset / limit) + 1 : page;
    const type = searchParams.get("type") || (user ? "following" : "global");

    // Validate type
    if (!VALID_TYPES.includes(type as any)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    if (type === "following" && !user) {
      return NextResponse.json(
        { error: "Unauthorized. Sign in to view your following feed." },
        { status: 401 }
      );
    }

    const feed = await getActivityFeed(user?.id || null, {
      page: actualPage,
      limit,
      type: type as "global" | "following",
      viewerId: user?.id,
    });

    return NextResponse.json(feed);
  } catch (error: any) {
    return handleApiError(error);
  }
}
