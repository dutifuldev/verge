import { useEffect, useMemo, useState } from "react";

import type { ProcessSpecSummary, RepositoryHealth, RunDetail } from "@verge/contracts";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

const currentRunIdFromHash = (): string | null => {
  const [, value] = window.location.hash.split("#/runs/");
  return value ?? null;
};

const formatDateTime = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "Pending";

export const statusTone = (status: string): string => {
  switch (status) {
    case "passed":
    case "reused":
    case "fresh":
      return "good";
    case "failed":
    case "stale":
      return "bad";
    case "running":
    case "queued":
      return "active";
    default:
      return "muted";
  }
};

const fetchJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      "content-type": "application/json",
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
};

export const App = () => {
  const [health, setHealth] = useState<RepositoryHealth | null>(null);
  const [processSpecs, setProcessSpecs] = useState<ProcessSpecSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(currentRunIdFromHash());
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [commitSha, setCommitSha] = useState("");
  const [branch, setBranch] = useState("main");
  const [changedFiles, setChangedFiles] = useState("");
  const [resumeFromCheckpoint, setResumeFromCheckpoint] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const syncHash = (): void => setSelectedRunId(currentRunIdFromHash());
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  useEffect(() => {
    const refresh = async (): Promise<void> => {
      try {
        const [nextHealth, nextSpecs] = await Promise.all([
          fetchJson<RepositoryHealth>("/repositories/verge/health"),
          fetchJson<ProcessSpecSummary[]>("/process-specs"),
        ]);
        setHealth(nextHealth);
        setProcessSpecs(nextSpecs);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to load dashboard");
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null);
      return;
    }

    const refresh = async (): Promise<void> => {
      try {
        const nextRun = await fetchJson<RunDetail>(`/runs/${selectedRunId}`);
        setSelectedRun(nextRun);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to load run");
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [selectedRunId]);

  const runCards = useMemo(() => {
    if (!health) {
      return [];
    }
    return [...health.activeRuns, ...health.recentRuns].slice(0, 8);
  }, [health]);

  const submitManualRun = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson<{ runIds: string[] }>("/run-requests/manual", {
        method: "POST",
        body: JSON.stringify({
          repositorySlug: "verge",
          commitSha: commitSha.trim(),
          branch: branch.trim() || undefined,
          changedFiles: changedFiles
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean),
          resumeFromCheckpoint,
        }),
      });

      if (response.runIds.length > 0) {
        window.location.hash = `/runs/${response.runIds[0]}`;
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to start run");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Evidence-Based CI/CD Control Plane</p>
          <h1>Verge runs Verge.</h1>
          <p className="lede">
            Manual requests, concrete processes, reusable evidence, and a live picture of repository
            health.
          </p>
        </div>
        <div className="heroCard">
          <span className={`tone ${statusTone(health?.activeRuns[0]?.status ?? "unknown")}`}>
            {health?.activeRuns.length ?? 0} active runs
          </span>
          <p className="heroMetric">{health?.recentRuns.length ?? 0}</p>
          <p className="heroLabel">Recent runs tracked for this repo</p>
        </div>
      </section>

      {error ? <div className="errorBanner">{error}</div> : null}

      <section className="grid">
        <article className="panel formPanel">
          <header>
            <p className="eyebrow">Manual Trigger</p>
            <h2>Create a run request</h2>
          </header>
          <label>
            Commit SHA
            <input
              value={commitSha}
              onChange={(event) => setCommitSha(event.target.value)}
              placeholder="Paste the commit SHA to evaluate"
            />
          </label>
          <label>
            Branch
            <input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              placeholder="main"
            />
          </label>
          <label>
            Changed files
            <textarea
              value={changedFiles}
              onChange={(event) => setChangedFiles(event.target.value)}
              placeholder={"apps/api/src/index.ts\ndocs/2026-04-12-verge-basic-objects.md"}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={resumeFromCheckpoint}
              onChange={(event) => setResumeFromCheckpoint(event.target.checked)}
            />
            Resume from the latest compatible checkpoint when available.
          </label>
          <button
            disabled={submitting || commitSha.trim().length === 0}
            onClick={() => void submitManualRun()}
          >
            {submitting ? "Submitting..." : "Start run"}
          </button>
        </article>

        <article className="panel">
          <header>
            <p className="eyebrow">Area Health</p>
            <h2>Repository coverage</h2>
          </header>
          <div className="stack">
            {health?.areaStates.map((area) => (
              <div className="areaRow" key={area.key}>
                <div>
                  <strong>{area.displayName}</strong>
                  <p>{area.key}</p>
                </div>
                <div className="meta">
                  <span className={`tone ${statusTone(area.latestStatus)}`}>
                    {area.latestStatus}
                  </span>
                  <small>{area.freshnessBucket}</small>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid">
        <article className="panel">
          <header>
            <p className="eyebrow">Specs</p>
            <h2>Registered process specs</h2>
          </header>
          <div className="specList">
            {processSpecs.map((spec) => (
              <div className="specCard" key={spec.id}>
                <div>
                  <strong>{spec.displayName}</strong>
                  <p>{spec.key}</p>
                </div>
                <div className="meta">
                  <span className="tone muted">{spec.kind}</span>
                  <small>
                    {spec.checkpointEnabled ? "checkpoint" : "stateless"} /{" "}
                    {spec.reuseEnabled ? "reusable" : "fresh"}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <header>
            <p className="eyebrow">Runs</p>
            <h2>Recent process-spec runs</h2>
          </header>
          <div className="runList">
            {runCards.map((run) => (
              <button
                className="runCard"
                key={run.id}
                onClick={() => {
                  window.location.hash = `/runs/${run.id}`;
                }}
              >
                <div>
                  <strong>{run.processSpecDisplayName}</strong>
                  <p>{run.processSpecKey}</p>
                </div>
                <div className="meta">
                  <span className={`tone ${statusTone(run.status)}`}>{run.status}</span>
                  <small>{formatDateTime(run.createdAt)}</small>
                </div>
              </button>
            ))}
          </div>
        </article>
      </section>

      <section className="panel detailPanel">
        <header>
          <p className="eyebrow">Run Detail</p>
          <h2>{selectedRun ? selectedRun.processSpecDisplayName : "Select a run"}</h2>
        </header>

        {selectedRun ? (
          <div className="detailGrid">
            <div>
              <div className="detailHeader">
                <span className={`tone ${statusTone(selectedRun.status)}`}>
                  {selectedRun.status}
                </span>
                <span>{selectedRun.planReason}</span>
              </div>
              <div className="stack">
                {selectedRun.processes.map((process) => (
                  <div className="processRow" key={process.id}>
                    <div>
                      <strong>{process.processLabel}</strong>
                      <p>{process.processKey}</p>
                    </div>
                    <div className="meta">
                      <span className={`tone ${statusTone(process.status)}`}>{process.status}</span>
                      <small>{formatDateTime(process.finishedAt)}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3>Observations</h3>
              <div className="stack compact">
                {selectedRun.observations.map((observation) => (
                  <div className="miniCard" key={observation.id}>
                    <div className="meta">
                      <strong>{observation.processKey ?? "run"}</strong>
                      <span className={`tone ${statusTone(observation.status)}`}>
                        {observation.status}
                      </span>
                    </div>
                    <pre>{JSON.stringify(observation.summary, null, 2)}</pre>
                  </div>
                ))}
              </div>
              <h3>Checkpoints</h3>
              <div className="stack compact">
                {selectedRun.checkpoints.map((checkpoint) => (
                  <div className="miniCard" key={checkpoint.id}>
                    <p>completed: {checkpoint.completedProcessKeys.join(", ") || "none"}</p>
                    <p>pending: {checkpoint.pendingProcessKeys.join(", ") || "none"}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="empty">
            Choose a run to inspect its processes, observations, and checkpoints.
          </p>
        )}
      </section>
    </main>
  );
};
