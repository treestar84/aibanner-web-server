import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { computeTier, POST_FREQUENCY_BY_TIER } from "@/lib/tier";
import { canPostNow } from "@/lib/post-gate";
import { requirePostToken } from "@/lib/post-token-auth";
import { isAllowedBlobImageUrl } from "@/lib/blob-image-url";
import { authorKeyFor } from "@/lib/author-key";

export const runtime = "nodejs";
export const revalidate = 0;

// points-ledger.ts의 kstDayBucket과 같은 이유: 서버는 UTC로 동작하므로 "오늘"을
// KST 기준으로 판정하려면 KST 자정에 해당하는 UTC 시각을 직접 계산해야 한다.
function kstMidnightUtc(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const kstMidnightMs =
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 60 * 60 * 1000;
  return new Date(kstMidnightMs);
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePostToken(req);
    if (auth instanceof NextResponse) return auth;
    const { deviceId, firstSeenAt, pointsTotal, lastPostAt, nickname } = auth;

    const tier = computeTier(firstSeenAt, pointsTotal);
    const gate = canPostNow(tier, lastPostAt);
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "Posting not allowed yet", nextAllowedAt: gate.nextAllowedAt ?? null },
        { status: 429 },
      );
    }

    const freq = POST_FREQUENCY_BY_TIER[tier];

    const body = await req.json().catch(() => null);
    const bodyKo = typeof body?.body === "string" ? body.body.trim() : "";
    if (!bodyKo) return NextResponse.json({ error: "body is required" }, { status: 400 });
    if (bodyKo.length > 1000) {
      return NextResponse.json({ error: "body exceeds 1000 characters" }, { status: 400 });
    }

    // imageUrl은 반드시 우리 업로드 엔드포인트가 돌려준 Blob URL이어야 한다.
    // 그러지 않으면 MIME/용량 검사를 다 우회해 임의 외부 이미지를 피드에 심을 수 있다.
    const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl.trim() : "";
    if (imageUrl && !isAllowedBlobImageUrl(imageUrl)) {
      return NextResponse.json(
        { error: "imageUrl must be an image uploaded via /api/v1/posts/upload-image" },
        { status: 400 },
      );
    }

    // ── 게시 빈도 게이트: 확인과 삽입을 한 문장으로 ─────────────────────────
    // 예전 구현은 오늘자 COUNT를 별도 왕복으로 읽고, 검사를 통과하면 아무 보호
    // 없이 INSERT했다. 같은 기기에서 두 요청이 동시에 오면 둘 다 상한 아래를
    // 읽고 둘 다 게시되어 perDay/쿨다운을 넘길 수 있었다.
    //
    // @neondatabase/serverless의 sql.transaction()은 non-interactive(쿼리
    // 배열을 한 번에 전송)라 앞 쿼리 결과로 뒤 쿼리를 바꿀 수 없어서,
    // check-then-insert를 그대로 트랜잭션으로 감쌀 수 없다. 그래서 points-ledger의
    // awardPoints와 같은 방식으로 카운트·쿨다운·삽입·last_post_at 갱신을 CTE
    // 하나로 묶어 단일 원자 문장으로 만들었다.
    //
    // 위의 canPostNow는 그대로 둔다: 빠른 실패 경로이자 nextAllowedAt 같은
    // 친절한 응답을 만드는 곳이고, 아래 SQL은 그 판정을 삽입 시점에 다시
    // 확인하는 마지막 방어선이다. 두 곳의 규칙(POST_FREQUENCY_BY_TIER)이
    // 갈라지지 않도록 SQL도 freq 값을 파라미터로 받아 쓴다.
    //
    // 알려진 한계: 단일 문장이라도 READ COMMITTED이므로 정확히 동시에 시작한
    // 두 문장은 서로의 미커밋 INSERT를 보지 못한다. 완전히 닫으려면 기기별
    // 어드바이저리 락이나 (device_id, kst_day, seq) 유니크 인덱스가 필요한데,
    // perDay가 등급마다 달라 후자는 행 단위 제약으로 표현되지 않는다.
    // 현재는 왕복 사이의 긴 경합 창(수십~수백 ms)을 단일 문장 수준으로 줄이는
    // 데까지만 했고, 남은 창에서 최대 1건 초과 게시가 가능하다.
    const todayStart = kstMidnightUtc(new Date());
    const inserted = (await sql`
      WITH gate AS (
        SELECT
          (SELECT COUNT(*)::int FROM expert_picks
            WHERE author_device_id = ${deviceId}
              AND author_type = 'user'
              AND created_at >= ${todayStart.toISOString()}) AS today_count,
          (SELECT last_post_at FROM device_principals
            WHERE device_id = ${deviceId}) AS last_post_at
      ),
      ins AS (
        INSERT INTO expert_picks (
          title_ko, body_ko, body_ko_raw, author_type, author_device_id,
          image_url, link_url, link_domain, sort_order, enabled
        )
        SELECT
          NULL, ${bodyKo}, ${bodyKo}, 'user', ${deviceId},
          ${imageUrl}, ${body?.linkUrl ?? ""}, ${body?.linkDomain ?? ""}, 0, true
        FROM gate g
        WHERE g.today_count < ${freq.perDay}::int
          AND (
            ${freq.cooldownDays}::int = 0
            OR g.last_post_at IS NULL
            OR g.last_post_at <= NOW() - (${freq.cooldownDays}::int * INTERVAL '1 day')
          )
        RETURNING id
      ),
      upd AS (
        UPDATE device_principals SET last_post_at = NOW()
        WHERE device_id = ${deviceId} AND EXISTS (SELECT 1 FROM ins)
        RETURNING device_id
      )
      SELECT (SELECT id FROM ins) AS id
    `) as { id: number | null }[];

    const insertedId = inserted[0]?.id ?? null;
    if (insertedId === null) {
      return NextResponse.json(
        { error: "Daily post limit reached for your tier", perDay: freq.perDay },
        { status: 429 },
      );
    }

    // author_nickname은 저장하지 않는다: 닉네임은 device_principals에서 조회 시점에 JOIN해
    // 최신 값을 보여준다(닉네임은 7일에 1회 변경 가능하므로 게시 시점 값을 박아넣으면
    // 이후 닉네임 변경 시 옛 글에 stale한 닉네임이 남는다).
    return NextResponse.json({ ok: true, id: insertedId, nickname });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/v1/posts][POST]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// 에디터픽(관리자가 제목까지 갖춰 직접 발행하는 콘텐츠)을 별도 화면이
// 아니라 이 커뮤니티 피드 안의 한 카테고리로 통합한다 — author_type 필터가
// 'user'만이 아니라 'user'/'editor' 둘 다다. title_ko/author_type도 함께
// 내려줘야 클라이언트가 에디터픽 항목에 제목/배지를 보여줄 수 있다.
//
// 관리자가 /api/admin/community-posts로 테스트 삼아 올린 글, 그리고
// 에디터픽은 둘 다 author_device_id가 NULL이라(실제 기기가 없음) INNER
// JOIN이면 통째로 사라진다. LEFT JOIN + COALESCE(dp.nickname,
// ep.author_label)로 바꿔서, 기기가 있으면 기기 닉네임을, 없으면 관리자가
// 지정한 author_label을 닉네임으로 쓴다. 실제 사용자 글은 author_device_id가
// 항상 있으므로 동작에 변화가 없다.
//
// is_admin_authored(=author_device_id IS NULL)는 클라이언트가 "이 글은
// 관리자가 수정/삭제할 수 있는 글인가"를 판단하는 용도다 — 원본 device_id는
// 여전히 내려주지 않고 불리언만 계산해서 준다.
//
// 이 세 쿼리(latest/likes/views)는 WHERE 절 앞부분(author_type IN (...)
// AND status = 'visible')이 겹친다. @neondatabase/serverless의 sql
// 템플릿 함수는 postgres.js와 달리 조각(fragment)을 다른 템플릿에
// 끼워 넣는 조합을 지원한다고 문서화돼 있지 않아, 안전하게 그냥 각
// 쿼리에 조건을 그대로 반복해서 썼다.

export async function GET(req: NextRequest) {
  try {
    const sortParam = req.nextUrl.searchParams.get("sort") ?? "latest";
    if (sortParam !== "latest" && sortParam !== "likes" && sortParam !== "views") {
      return NextResponse.json(
        { error: "sort must be 'latest', 'likes', or 'views'" },
        { status: 400 },
      );
    }

    if (sortParam === "latest") {
      // 커서는 숫자여야 한다. 검증 없이 parseInt하면 ?cursor=abc가 NaN이 되어
      // 그대로 쿼리 파라미터로 나가고, 500이나 예상 밖 결과로 이어진다.
      const cursor = req.nextUrl.searchParams.get("cursor");
      let cursorId: number | null = null;
      if (cursor !== null && cursor !== "") {
        const parsed = Number.parseInt(cursor, 10);
        if (!Number.isFinite(parsed)) {
          return NextResponse.json({ error: "cursor must be an integer" }, { status: 400 });
        }
        cursorId = parsed;
      }

      const rows = await sql`
        SELECT ep.id, ep.title_ko, ep.body_ko AS body, ep.image_url, ep.link_url,
               ep.link_domain, ep.author_type,
               COALESCE(dp.nickname, ep.author_label) AS author_nickname,
               dp.device_id AS author_device_id,
               (dp.device_id IS NULL) AS is_admin_authored,
               ep.created_at
        FROM expert_picks ep
        LEFT JOIN device_principals dp ON dp.device_id = ep.author_device_id
        WHERE ep.author_type IN ('user', 'editor') AND ep.status = 'visible'
          AND (${cursorId}::int IS NULL OR ep.id < ${cursorId}::int)
        ORDER BY ep.id DESC
        LIMIT 20
      `;
      return NextResponse.json({ items: mapRows(rows) });
    }

    // sort='likes'|'views': "최근 30일" 콘텐츠로 한정한다 — 오래전에 쌓인
    // 좋아요/조회수가 최신 활동을 영영 밀어내지 않도록. id 커서 대신 offset을
    // 쓴다: 정렬 기준이 like_count/view_count라 id처럼 단조 증가하지 않아서
    // "마지막으로 본 id보다 작은 것"이라는 커서 개념이 성립하지 않는다.
    // 30일로 범위가 좁혀진 목록이라 offset 페이지네이션의 통상적인 단점
    // (동시 삽입 시 밀림/중복)은 감내할 만하다고 판단했다.
    const offsetParam = req.nextUrl.searchParams.get("offset");
    let offset = 0;
    if (offsetParam !== null && offsetParam !== "") {
      const parsed = Number.parseInt(offsetParam, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return NextResponse.json({ error: "offset must be a non-negative integer" }, { status: 400 });
      }
      offset = parsed;
    }

    const rows =
      sortParam === "likes"
        ? await sql`
            SELECT ep.id, ep.title_ko, ep.body_ko AS body, ep.image_url, ep.link_url,
                   ep.link_domain, ep.author_type,
                   COALESCE(dp.nickname, ep.author_label) AS author_nickname,
                   dp.device_id AS author_device_id,
                   (dp.device_id IS NULL) AS is_admin_authored,
                   ep.created_at, COALESCE(cl.like_count, 0) AS like_count
            FROM expert_picks ep
            LEFT JOIN device_principals dp ON dp.device_id = ep.author_device_id
            LEFT JOIN content_likes cl ON cl.content_type = 'expertPicks' AND cl.content_id = ep.id::text
            WHERE ep.author_type IN ('user', 'editor') AND ep.status = 'visible'
              AND ep.created_at >= NOW() - INTERVAL '30 days'
            ORDER BY like_count DESC, ep.id DESC
            LIMIT 20 OFFSET ${offset}
          `
        : await sql`
            SELECT ep.id, ep.title_ko, ep.body_ko AS body, ep.image_url, ep.link_url,
                   ep.link_domain, ep.author_type,
                   COALESCE(dp.nickname, ep.author_label) AS author_nickname,
                   dp.device_id AS author_device_id,
                   (dp.device_id IS NULL) AS is_admin_authored,
                   ep.created_at, ep.view_count
            FROM expert_picks ep
            LEFT JOIN device_principals dp ON dp.device_id = ep.author_device_id
            WHERE ep.author_type IN ('user', 'editor') AND ep.status = 'visible'
              AND ep.created_at >= NOW() - INTERVAL '30 days'
            ORDER BY ep.view_count DESC, ep.id DESC
            LIMIT 20 OFFSET ${offset}
          `;
    return NextResponse.json({ items: mapRows(rows) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[/api/v1/posts][GET]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// author_device_id는 클라이언트에 원본 그대로 내려주지 않는다 — 대신
// 클라이언트가 "이 작성자 차단"에 쓸 수 있는 안정적인 익명 해시 키로
// 바꿔치기한다(authorKeyFor 문서 참고).
function mapRows(rows: Record<string, unknown>[]) {
  return rows.map(({ author_device_id, ...rest }) => ({
    ...rest,
    author_key: authorKeyFor(author_device_id as string | null),
  }));
}
