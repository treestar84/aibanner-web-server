import { NextRequest, NextResponse } from "next/server";
import {
  adminUnauthorizedResponse,
  isAdminAuthConfigured,
  verifyAdminBasicAuth,
} from "@/lib/admin-auth";

// ─── Rate Limiting ───────────────────────────────────────────────────────────
// 서버리스 인스턴스 내 메모리 기반 슬라이딩 윈도우.
// Redis 없이 할 수 있는 최선: 동일 인스턴스 내 단기 burst 차단에 효과적.

const WINDOW_MS = 60_000; // 1분 윈도우
const MAX_TRACKER_ENTRIES = 10_000; // 메모리 보호 상한

function getMcpRateLimitRpm(): number {
  const parsed = Number.parseInt(process.env.MCP_RATE_LIMIT_RPM ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

// 경로 prefix별 분당 허용 요청 수 (IP당)
const RATE_LIMITS: [prefix: string, rpm: number][] = [
  ["/api/v1/search", 10],     // Tavily 비용 보호 — 검색은 빡빡하게
  ["/api/v1/keywords/views", 15], // 순위 집계 엔드포인트는 별도 제한
  ["/api/v1/trends", 30],     // 트렌드 목록
  ["/api/v1/keywords", 60],   // 키워드 상세 (여러 개 탐색 고려)
  ["/api/v1/", 100],          // 기타 v1 엔드포인트
  ["/api/mcp", 60],           // MCP 서버 — PlayMCP 등 게이트웨이 대비, env MCP_RATE_LIMIT_RPM으로 조정
];

type WindowEntry = { count: number; windowStart: number };
const tracker = new Map<string, WindowEntry>();

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0].trim() || "unknown";
}

function getRpm(pathname: string): number {
  if (pathname.startsWith("/api/mcp")) return getMcpRateLimitRpm();
  for (const [prefix, rpm] of RATE_LIMITS) {
    if (pathname.startsWith(prefix)) return rpm;
  }
  return 100;
}

function isRateLimited(ip: string, pathname: string): boolean {
  // 키를 경로의 앞 4세그먼트까지만 사용해 키워드별 세분화 방지
  const routeKey = pathname.split("/").slice(0, 4).join("/");
  const key = `${ip}::${routeKey}`;
  const rpm = getRpm(pathname);
  const now = Date.now();

  const entry = tracker.get(key);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    tracker.set(key, { count: 1, windowStart: now });
    return false; // 새 윈도우 시작 — 허용
  }
  if (entry.count >= rpm) return true; // 한도 초과 — 차단
  entry.count++;
  return false; // 허용
}

function maybeCleanupTracker() {
  if (tracker.size < MAX_TRACKER_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of tracker) {
    if (now - v.windowStart >= WINDOW_MS) tracker.delete(k);
  }
}

// ─── Admin Auth ───────────────────────────────────────────────────────────────

// ─── Middleware ───────────────────────────────────────────────────────────────

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1) Admin 영역 — Basic Auth
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (!isAdminAuthConfigured()) {
      return NextResponse.json(
        { error: "ADMIN auth is not configured on server" },
        { status: 503 }
      );
    }
    const authorized = await verifyAdminBasicAuth(
      req.headers.get("authorization")
    );
    if (!authorized) return adminUnauthorizedResponse();
    return NextResponse.next();
  }

  // 2) Public API — IP Rate Limiting
  if (pathname.startsWith("/api/v1/") || pathname.startsWith("/api/mcp")) {
    maybeCleanupTracker();
    const ip = getClientIp(req);
    if (isRateLimited(ip, pathname)) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "Retry-After": "60",
            "X-RateLimit-Limit": String(getRpm(pathname)),
            "X-RateLimit-Window": "60s",
          },
        }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/v1/:path*",
    "/api/mcp/:path*",
  ],
};
