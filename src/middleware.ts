import { NextRequest, NextResponse } from "next/server";
import {
  isAdminAuthConfigured,
  verifyAdminBasicAuth,
} from "@/lib/admin-auth";

function unauthorizedResponse() {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Admin Area", charset="UTF-8"',
    },
  });
}

export async function middleware(req: NextRequest) {
  if (!isAdminAuthConfigured()) {
    return NextResponse.json(
      { error: "ADMIN auth is not configured on server" },
      { status: 503 }
    );
  }

  const authorized = await verifyAdminBasicAuth(
    req.headers.get("authorization")
  );
  if (!authorized) {
    return unauthorizedResponse();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
