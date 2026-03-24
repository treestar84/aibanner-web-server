"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Candidate {
  snapshot_id: string;
  keyword: string;
  keyword_normalized: string;
  score_recency: number;
  score_frequency: number;
  score_authority: number;
  score_velocity: number;
  score_internal: number;
  total_score: number;
  source_count: number;
  top_source_title: string | null;
  top_source_domain: string | null;
  is_manual: boolean;
}

interface Weights {
  w_recency: number;
  w_frequency: number;
  w_authority: number;
  w_velocity: number;
  w_internal: number;
  updated_at: string;
}

interface SnapshotInfo {
  snapshot_id: string;
  updated_at_utc: string;
  created_at: string;
}

interface SimulatorData {
  candidates: Candidate[];
  weights: Weights;
  snapshotId: string | null;
  updatedAt: string | null;
  recentSnapshots: SnapshotInfo[];
}

interface SimWeights {
  recency: number;
  frequency: number;
  authority: number;
  velocity: number;
  internal: number;
}

function formatKst(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function recalculate(
  candidates: Candidate[],
  weights: SimWeights
): Array<Candidate & { simTotal: number; simRank: number; origRank: number }> {
  // 원래 순위 기록
  const sorted = [...candidates]
    .sort((a, b) => b.total_score - a.total_score)
    .map((c, i) => ({ ...c, origRank: i + 1 }));

  // 시뮬레이션 점수 계산
  const withSim = sorted.map((c) => ({
    ...c,
    simTotal: parseFloat(
      (
        c.score_recency * weights.recency +
        c.score_frequency * weights.frequency +
        c.score_authority * weights.authority +
        c.score_velocity * weights.velocity +
        c.score_internal * weights.internal
      ).toFixed(4)
    ),
  }));

  // 시뮬레이션 점수로 재정렬
  withSim.sort((a, b) => b.simTotal - a.simTotal);

  return withSim.map((c, i) => ({ ...c, simRank: i + 1 }));
}

function RankDelta({ orig, sim }: { orig: number; sim: number }) {
  const diff = orig - sim; // 양수 = 상승
  if (diff === 0) return <span className="text-zinc-500">-</span>;
  if (diff > 0)
    return <span className="text-emerald-400 font-bold">▲{diff}</span>;
  return <span className="text-red-400 font-bold">▼{Math.abs(diff)}</span>;
}

export default function RankingSimulatorPage() {
  const [data, setData] = useState<SimulatorData | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // 시뮬레이션 가중치 (슬라이더용)
  const [simWeights, setSimWeights] = useState<SimWeights>({
    recency: 0.42,
    frequency: 0.16,
    authority: 0.10,
    velocity: 0.32,
    internal: 0.00,
  });

  // 서버 저장 가중치 (리셋용)
  const [serverWeights, setServerWeights] = useState<SimWeights>(simWeights);

  const loadData = useCallback(
    async (snapshotId?: string) => {
      setLoading(true);
      setError(null);
      try {
        const query = snapshotId ? `?snapshotId=${snapshotId}` : "";
        const res = await fetch(`/api/admin/ranking-simulator${query}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const json = (await res.json()) as SimulatorData;
        setData(json);
        if (json.snapshotId && !snapshotId) {
          setSelectedSnapshot(json.snapshotId);
        }
        if (json.weights) {
          const w: SimWeights = {
            recency: json.weights.w_recency,
            frequency: json.weights.w_frequency,
            authority: json.weights.w_authority,
            velocity: json.weights.w_velocity,
            internal: json.weights.w_internal,
          };
          setSimWeights(w);
          setServerWeights(w);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "데이터 로드에 실패했습니다."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSnapshotChange = (snapshotId: string) => {
    setSelectedSnapshot(snapshotId);
    loadData(snapshotId);
  };

  const handleWeightChange = (key: keyof SimWeights, value: number) => {
    setSimWeights((prev) => ({ ...prev, [key]: value }));
  };

  const handleReset = () => {
    setSimWeights(serverWeights);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/admin/ranking-simulator", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(simWeights),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `${res.status}`
        );
      }
      setServerWeights(simWeights);
      setSaveMsg("가중치가 저장되었습니다. 다음 파이프라인 실행 시 반영됩니다.");
    } catch (err) {
      setSaveMsg(
        `저장 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`
      );
    } finally {
      setSaving(false);
    }
  };

  const weightSum = useMemo(
    () =>
      parseFloat(
        (
          simWeights.recency +
          simWeights.frequency +
          simWeights.authority +
          simWeights.velocity +
          simWeights.internal
        ).toFixed(4)
      ),
    [simWeights]
  );

  const simulatedCandidates = useMemo(() => {
    if (!data?.candidates?.length) return [];
    return recalculate(data.candidates, simWeights);
  }, [data?.candidates, simWeights]);

  const isModified = useMemo(() => {
    return (
      simWeights.recency !== serverWeights.recency ||
      simWeights.frequency !== serverWeights.frequency ||
      simWeights.authority !== serverWeights.authority ||
      simWeights.velocity !== serverWeights.velocity ||
      simWeights.internal !== serverWeights.internal
    );
  }, [simWeights, serverWeights]);

  const WEIGHT_KEYS: Array<{ key: keyof SimWeights; label: string; color: string }> = [
    { key: "recency", label: "Recency", color: "accent-blue-400" },
    { key: "frequency", label: "Frequency", color: "accent-purple-400" },
    { key: "authority", label: "Authority", color: "accent-amber-400" },
    { key: "velocity", label: "Velocity", color: "accent-emerald-400" },
    { key: "internal", label: "Internal", color: "accent-red-400" },
  ];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-8">
      <section className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <a
                href="/admin"
                className="text-sm text-zinc-400 hover:text-zinc-200"
              >
                &larr; 관리자
              </a>
            </div>
            <h1 className="text-2xl font-black tracking-tight">
              랭킹 시뮬레이터
            </h1>
            <p className="text-sm text-zinc-400 mt-1">
              가중치를 조절하여 키워드 랭킹 변화를 시뮬레이션합니다.
              적용 버튼으로 다음 파이프라인에 반영할 수 있습니다.
            </p>
          </div>

          {/* 스냅샷 선택 */}
          {data?.recentSnapshots && data.recentSnapshots.length > 0 && (
            <select
              value={selectedSnapshot}
              onChange={(e) => handleSnapshotChange(e.target.value)}
              className="rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            >
              {data.recentSnapshots.map((s) => (
                <option key={s.snapshot_id} value={s.snapshot_id}>
                  {s.snapshot_id} ({formatKst(s.updated_at_utc)})
                </option>
              ))}
            </select>
          )}
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-red-400/60 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

        {saveMsg && (
          <div
            className={`mb-4 rounded-lg px-3 py-2 text-sm font-semibold ${
              saveMsg.startsWith("저장 실패")
                ? "border border-red-400/60 bg-red-500/10 text-red-100"
                : "border border-emerald-400/60 bg-emerald-500/10 text-emerald-100"
            }`}
          >
            {saveMsg}
          </div>
        )}

        {/* 가중치 슬라이더 패널 */}
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">가중치 설정</h2>
            <div className="flex items-center gap-3">
              <span
                className={`text-sm font-mono ${
                  Math.abs(weightSum - 1) < 0.01
                    ? "text-emerald-400"
                    : "text-amber-400"
                }`}
              >
                합계: {weightSum.toFixed(2)}
              </span>
              <button
                type="button"
                onClick={handleReset}
                disabled={!isModified}
                className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40"
              >
                리셋
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-emerald-500 text-zinc-900 px-4 py-1.5 text-xs font-bold disabled:opacity-60"
              >
                {saving ? "저장 중..." : "적용"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
            {WEIGHT_KEYS.map(({ key, label }) => (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-zinc-400">{label}</label>
                  <span className="text-xs font-mono text-zinc-200">
                    {simWeights[key].toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={simWeights[key]}
                  onChange={(e) =>
                    handleWeightChange(key, parseFloat(e.target.value))
                  }
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-zinc-700 accent-emerald-400"
                />
              </div>
            ))}
          </div>
        </div>

        {/* 후보 테이블 */}
        {loading ? (
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-8 text-center text-zinc-400">
            불러오는 중...
          </div>
        ) : simulatedCandidates.length === 0 ? (
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-8 text-center text-zinc-400">
            후보 데이터가 없습니다. 파이프라인이 실행된 후에 후보가 저장됩니다.
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/70 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-700 text-zinc-400 text-xs">
                  <th className="px-3 py-3 text-left w-12">순위</th>
                  <th className="px-3 py-3 text-left w-12">변동</th>
                  <th className="px-3 py-3 text-left">키워드</th>
                  <th className="px-3 py-3 text-right w-16">R</th>
                  <th className="px-3 py-3 text-right w-16">F</th>
                  <th className="px-3 py-3 text-right w-16">A</th>
                  <th className="px-3 py-3 text-right w-16">V</th>
                  <th className="px-3 py-3 text-right w-16">I</th>
                  <th className="px-3 py-3 text-right w-20">가중합</th>
                  <th className="px-3 py-3 text-right w-16">원본</th>
                  <th className="px-3 py-3 text-right w-14">출처</th>
                  <th className="px-3 py-3 text-left">도메인</th>
                </tr>
              </thead>
              <tbody>
                {simulatedCandidates.map((c) => (
                  <tr
                    key={c.keyword_normalized}
                    className={`border-b border-zinc-800 hover:bg-zinc-800/50 ${
                      c.is_manual ? "bg-amber-500/5" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-mono font-bold text-zinc-200">
                      {c.simRank}
                    </td>
                    <td className="px-3 py-2">
                      <RankDelta orig={c.origRank} sim={c.simRank} />
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{c.keyword}</span>
                      {c.is_manual && (
                        <span className="ml-2 text-[10px] rounded px-1.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          수동
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-zinc-300">
                      {c.score_recency.toFixed(3)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-zinc-300">
                      {c.score_frequency.toFixed(3)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-zinc-300">
                      {c.score_authority.toFixed(3)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-zinc-300">
                      {c.score_velocity.toFixed(3)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-zinc-300">
                      {c.score_internal.toFixed(3)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-emerald-300">
                      {c.simTotal.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-zinc-500">
                      {c.total_score.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-zinc-400">
                      {c.source_count}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500 truncate max-w-[120px]">
                      {c.top_source_domain ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-zinc-600 mt-3 text-right">
          후보 {simulatedCandidates.length}개
          {data?.snapshotId && ` · ${data.snapshotId}`}
        </p>
      </section>
    </main>
  );
}
