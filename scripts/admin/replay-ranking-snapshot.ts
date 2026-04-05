import {
  getRankingWeights,
  getSnapshotCandidates,
} from "@/lib/db/queries";
import { summarizeRankingReplay } from "@/lib/admin/ranking_replay";

function parseArgs(argv: string[]): { snapshotId: string; top: number } {
  const [snapshotId, ...rest] = argv;
  if (!snapshotId) {
    throw new Error("usage: npx tsx scripts/admin/replay-ranking-snapshot.ts <snapshotId> [--top=10]");
  }

  const topArg = rest.find((arg) => arg.startsWith("--top="));
  const top = topArg ? Number.parseInt(topArg.slice("--top=".length), 10) : 10;
  return {
    snapshotId,
    top: Number.isFinite(top) && top > 0 ? top : 10,
  };
}

async function main() {
  const { snapshotId, top } = parseArgs(process.argv.slice(2));
  const [candidates, weights] = await Promise.all([
    getSnapshotCandidates(snapshotId),
    getRankingWeights(),
  ]);

  if (candidates.length === 0) {
    throw new Error(`snapshot candidates not found: ${snapshotId}`);
  }

  const summary = summarizeRankingReplay(
    candidates,
    {
      recency: weights.w_recency,
      frequency: weights.w_frequency,
      authority: weights.w_authority,
      velocity: weights.w_velocity,
      engagement: weights.w_engagement,
    },
    top
  );

  console.log(
    JSON.stringify(
      {
        snapshotId,
        top,
        comparedCount: summary.comparedCount,
        exactScoreMatches: summary.exactScoreMatches,
        exactRankMatches: summary.exactRankMatches,
        mismatches: summary.mismatches,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[replay-ranking-snapshot]", error);
  process.exit(1);
});
