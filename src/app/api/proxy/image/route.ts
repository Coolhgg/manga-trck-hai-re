import { NextRequest, NextResponse } from "next/server"
import { 
  isWhitelistedDomain, 
  isInternalIP,
  ALLOWED_CONTENT_TYPES, 
  MAX_IMAGE_SIZE 
} from "@/lib/constants/image-whitelist"
import { checkRateLimit } from "@/lib/api-utils"

const CACHE_DURATION = 60 * 60 * 24 * 7

export async function GET(request: NextRequest) {
  // Rate limit: 100 requests per minute per IP
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown"
  if (!checkRateLimit(`image-proxy:${ip}`, 100, 60000)) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429 }
    )
  }

  const url = request.nextUrl.searchParams.get('url')

  if (!url) {
    return NextResponse.json(
      { error: 'Missing url parameter' },
      { status: 400 }
    )
  }

  let decodedUrl: string
  try {
    decodedUrl = decodeURIComponent(url)
  } catch {
    return NextResponse.json(
      { error: 'Invalid URL encoding' },
      { status: 400 }
    )
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(decodedUrl)
  } catch {
    return NextResponse.json(
      { error: 'Invalid URL format' },
      { status: 400 }
    )
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return NextResponse.json(
      { error: 'Invalid protocol. Only HTTP/HTTPS allowed' },
      { status: 400 }
    )
  }

  // SECURITY: Block SSRF attacks by checking for internal IPs
  if (isInternalIP(parsedUrl.hostname)) {
    return NextResponse.json(
      { error: 'Internal addresses are not allowed' },
      { status: 403 }
    )
  }

  if (!isWhitelistedDomain(decodedUrl)) {
    return NextResponse.json(
      { error: 'Domain not whitelisted', domain: parsedUrl.hostname },
      { status: 403 }
    )
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(decodedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Kenmei-ImageProxy/1.0',
        'Accept': 'image/*',
        'Referer': parsedUrl.origin,
      },
    })

    clearTimeout(timeout)

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch image', status: response.status },
        { status: response.status }
      )
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() || ''
    const isValidType = ALLOWED_CONTENT_TYPES.some(type => 
      contentType.includes(type.replace('image/', ''))
    )

    if (!isValidType) {
      return NextResponse.json(
        { error: 'Invalid content type', contentType },
        { status: 415 }
      )
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0')
    if (contentLength > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        { error: 'Image too large', maxSize: MAX_IMAGE_SIZE },
        { status: 413 }
      )
    }

    const imageBuffer = await response.arrayBuffer()

    if (imageBuffer.byteLength > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        { error: 'Image too large', maxSize: MAX_IMAGE_SIZE },
        { status: 413 }
      )
    }

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'image/jpeg',
        'Content-Length': imageBuffer.byteLength.toString(),
        'Cache-Control': `public, max-age=${CACHE_DURATION}, immutable`,
        'X-Proxy-Cache': 'HIT',
        'X-Original-URL': parsedUrl.hostname,
        'X-Content-Type-Options': 'nosniff',
      },
    })

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Request timeout' },
        { status: 504 }
      )
    }

    console.error('Image proxy error:', error)
    return NextResponse.json(
      { error: 'Failed to proxy image' },
      { status: 500 }
    )
  }
}
