import { useEffect, useMemo, useState } from "react";

import type {
  PaginatedRunList,
  ProcessSpecSummary,
  RepositoryHealth,
  RunDetail,
  RunRequestDetail,
  RunSummary,
} from "@verge/contracts";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api";

type AppRoute =
  | { name: "overview" }
  | {
      name: "runs";
      page: number;
      status: string;
      trigger: string;
      processSpecKey: string;
    }
  | { name: "run"; runId: string };

const parseRoute = (): AppRoute => {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const search = new URLSearchParams(window.location.search);

  if (path === "/runs") {
    const pageValue = Number(search.get("page") ?? "1");
    return {
      name: "runs",
      page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
      status: search.get("status") ?? "",
      trigger: search.get("trigger") ?? "",
      processSpecKey: search.get("processSpecKey") ?? "",
    };
  }

  if (path.startsWith("/runs/")) {
    const runId = path.replace("/runs/", "").trim();
    if (runId) {
      return { name: "run", runId };
    }
  }

  return { name: "overview" };
};

const navigate = (path: string): void => {
  if (`${window.location.pathname}${window.location.search}` === path) {
    return;
  }

  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
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

const formatDateTime = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "Pending";

const formatRelativeTime = (value: string): string => {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (Math.abs(diffMinutes) < 1) {
    return "just now";
  }

  if (Math.abs(diffMinutes) < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
};

const formatDuration = (startedAt: string | null, finishedAt: string | null): string => {
  if (!startedAt) {
    return "Pending";
  }

  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const diffSeconds = Math.max(0, Math.round((end - start) / 1000));

  if (diffSeconds < 60) {
    return `${diffSeconds}s`;
  }

  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
};

const normalizeLabel = (value: string): string => value.trim().toLowerCase();

const shouldShowSecondaryKey = (displayName: string, key: string): boolean =>
  normalizeLabel(displayName) !== normalizeLabel(key);

const shortSha = (value: string): string => value.slice(0, 7);

const classifyExecutionMode = (
  run: Pick<RunSummary, "reusedFromRunId" | "checkpointSourceRunId" | "status">,
): string => {
  if (run.reusedFromRunId) {
    return "reused";
  }

  if (run.checkpointSourceRunId) {
    return "resumed";
  }

  if (run.status === "reused") {
    return "reused";
  }

  return "fresh";
};

export const statusTone = (status: string): string => {
  switch (status) {
    case "passed":
    case "reused":
    case "fresh":
      return "good";
    case "failed":
    case "interrupted":
    case "stale":
      return "bad";
    case "running":
    case "queued":
      return "active";
    default:
      return "muted";
  }
};

const StatusPill = ({ status }: { status: string }) => (
  <span className={`statusPill ${statusTone(status)}`}>{status}</span>
);

const NavLink = ({ active, href, label }: { active: boolean; href: string; label: string }) => (
  <a
    className={`navLink ${active ? "active" : ""}`}
    href={href}
    onClick={(event) => {
      event.preventDefault();
      navigate(href);
    }}
  >
    {label}
  </a>
);

const EmptyState = ({ title, body }: { title: string; body: string }) => (
  <div className="emptyState">
    <h3>{title}</h3>
    <p>{body}</p>
  </div>
);

const OverviewPage = ({
  health,
  processSpecs,
  error,
  commitSha,
  branch,
  changedFiles,
  resumeFromCheckpoint,
  submitting,
  onCommitShaChange,
  onBranchChange,
  onChangedFilesChange,
  onResumeFromCheckpointChange,
  onSubmit,
}: {
  health: RepositoryHealth | null;
  processSpecs: ProcessSpecSummary[];
  error: string | null;
  commitSha: string;
  branch: string;
  changedFiles: string;
  resumeFromCheckpoint: boolean;
  submitting: boolean;
  onCommitShaChange: (value: string) => void;
  onBranchChange: (value: string) => void;
  onChangedFilesChange: (value: string) => void;
  onResumeFromCheckpointChange: (value: boolean) => void;
  onSubmit: () => void;
}) => {
  const recentRuns = health?.recentRuns.slice(0, 6) ?? [];

  return (
    <div className="pageStack">
      <section className="overviewHeader">
        <div>
          <h1>Repository health and recent evaluation state</h1>
          <p className="pageIntro">
            Track the current repository state, active work, and recent process-spec runs without
            collapsing everything into one mixed dashboard.
          </p>
        </div>
        <div className="summaryGrid">
          <div className="summaryCard">
            <span className="summaryLabel">Active runs</span>
            <strong>{health?.activeRuns.length ?? 0}</strong>
            <span className="summaryMeta">Currently queued or executing</span>
          </div>
          <div className="summaryCard">
            <span className="summaryLabel">Recent runs</span>
            <strong>{health?.recentRuns.length ?? 0}</strong>
            <span className="summaryMeta">Visible in the current health window</span>
          </div>
          <div className="summaryCard">
            <span className="summaryLabel">Process specs</span>
            <strong>{processSpecs.length}</strong>
            <span className="summaryMeta">Registered for this repository</span>
          </div>
        </div>
      </section>

      {error ? <div className="errorBanner">{error}</div> : null}

      <section className="twoColumnLayout">
        <article className="panel">
          <header className="panelHeader">
            <h2>Create a run request</h2>
          </header>
          <div className="formGrid">
            <label className="field">
              <span>Commit SHA</span>
              <input
                value={commitSha}
                onChange={(event) => onCommitShaChange(event.target.value)}
                placeholder="Paste the commit SHA to evaluate"
              />
            </label>
            <label className="field">
              <span>Branch</span>
              <input
                value={branch}
                onChange={(event) => onBranchChange(event.target.value)}
                placeholder="main"
              />
            </label>
            <label className="field span2">
              <span>Changed files</span>
              <textarea
                value={changedFiles}
                onChange={(event) => onChangedFilesChange(event.target.value)}
                placeholder={"apps/web/src/App.tsx\napps/web/src/styles.css"}
              />
            </label>
            <label className="checkboxField span2">
              <input
                type="checkbox"
                checked={resumeFromCheckpoint}
                onChange={(event) => onResumeFromCheckpointChange(event.target.checked)}
              />
              <span>Resume from the latest compatible checkpoint when available.</span>
            </label>
          </div>
          <div className="panelActions">
            <button
              className="primaryButton"
              disabled={submitting || commitSha.trim().length === 0}
              onClick={() => void onSubmit()}
            >
              {submitting ? "Submitting..." : "Start run"}
            </button>
          </div>
        </article>

        <article className="panel">
          <header className="panelHeader">
            <h2>Repository coverage</h2>
          </header>
          {health?.areaStates.length ? (
            <div className="keyValueList">
              {health.areaStates.map((area) => (
                <div className="keyValueRow" key={area.key}>
                  <div>
                    <strong>{area.displayName}</strong>
                    {shouldShowSecondaryKey(area.displayName, area.key) ? (
                      <span className="secondaryText">{area.key}</span>
                    ) : null}
                  </div>
                  <div className="rowMeta">
                    <StatusPill status={area.latestStatus} />
                    <span className="secondaryText">{area.freshnessBucket}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No area state yet"
              body="Run the repository once to populate area health."
            />
          )}
        </article>
      </section>

      <section className="twoColumnLayout">
        <article className="panel">
          <header className="panelHeader">
            <h2>Registered evaluations</h2>
          </header>
          <div className="specGrid">
            {processSpecs.map((spec) => (
              <div className="specCard" key={spec.id}>
                <div className="specHeader">
                  <strong>{spec.displayName}</strong>
                  <span className="monoText">{spec.key}</span>
                </div>
                <p>{spec.description}</p>
                <div className="badgeRow">
                  <span className="subtleBadge">{spec.kind}</span>
                  <span className="subtleBadge">
                    {spec.checkpointEnabled ? "checkpoint" : "stateless"}
                  </span>
                  <span className="subtleBadge">{spec.reuseEnabled ? "reusable" : "fresh"}</span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <header className="panelHeader">
            <h2>Latest activity</h2>
            <a
              className="panelLink"
              href="/runs"
              onClick={(event) => {
                event.preventDefault();
                navigate("/runs");
              }}
            >
              Open runs table
            </a>
          </header>
          {recentRuns.length ? (
            <div className="stackList">
              {recentRuns.map((run) => (
                <button
                  className="listButton"
                  key={run.id}
                  onClick={() => navigate(`/runs/${run.id}`)}
                >
                  <div>
                    <strong>{run.processSpecDisplayName}</strong>
                    <span className="secondaryText">
                      {shortSha(run.id)} · {formatRelativeTime(run.createdAt)}
                    </span>
                  </div>
                  <div className="rowMeta">
                    <StatusPill status={run.status} />
                    <span className="secondaryText">{classifyExecutionMode(run)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No runs yet"
              body="Push a commit or create a manual run request to see results here."
            />
          )}
        </article>
      </section>
    </div>
  );
};

const RunsPage = ({
  runsPage,
  processSpecs,
  draftFilters,
  onDraftFilterChange,
  onApplyFilters,
  onPageChange,
}: {
  runsPage: PaginatedRunList | null;
  processSpecs: ProcessSpecSummary[];
  draftFilters: { status: string; trigger: string; processSpecKey: string };
  onDraftFilterChange: (key: "status" | "trigger" | "processSpecKey", value: string) => void;
  onApplyFilters: () => void;
  onPageChange: (page: number) => void;
}) => {
  const totalPages = runsPage ? Math.max(1, Math.ceil(runsPage.total / runsPage.pageSize)) : 1;

  return (
    <div className="pageStack">
      <section className="pageHeader">
        <div>
          <h1>Run history</h1>
          <p className="pageIntro">
            One row per run. This is the main operational view for browsing process-spec
            evaluations.
          </p>
        </div>
      </section>

      <section className="panel">
        <header className="panelHeader">
          <h2>Browse runs</h2>
        </header>
        <div className="filterGrid">
          <label className="field">
            <span>Status</span>
            <select
              value={draftFilters.status}
              onChange={(event) => onDraftFilterChange("status", event.target.value)}
            >
              <option value="">All</option>
              {["passed", "failed", "running", "queued", "reused", "interrupted"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Trigger</span>
            <select
              value={draftFilters.trigger}
              onChange={(event) => onDraftFilterChange("trigger", event.target.value)}
            >
              <option value="">All</option>
              {["manual", "push", "pull_request"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Process spec</span>
            <select
              value={draftFilters.processSpecKey}
              onChange={(event) => onDraftFilterChange("processSpecKey", event.target.value)}
            >
              <option value="">All</option>
              {processSpecs.map((spec) => (
                <option key={spec.id} value={spec.key}>
                  {spec.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="panelActions">
          <button className="secondaryButton" onClick={onApplyFilters}>
            Apply filters
          </button>
        </div>
      </section>

      <section className="panel tablePanel">
        <header className="panelHeader">
          <h2>Runs</h2>
          <div className="secondaryText">{runsPage ? `${runsPage.total} total` : "Loading"}</div>
        </header>
        {runsPage?.items.length ? (
          <>
            <div className="tableScroller">
              <table className="dataTable">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Process spec</th>
                    <th>Commit</th>
                    <th>Trigger</th>
                    <th>Ref</th>
                    <th>Execution</th>
                    <th>Created</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {runsPage.items.map((run) => (
                    <tr
                      key={run.id}
                      className="clickableRow"
                      onClick={() => navigate(`/runs/${run.id}`)}
                    >
                      <td>
                        <StatusPill status={run.status} />
                      </td>
                      <td>
                        <div className="cellStack">
                          <strong>{run.processSpecDisplayName}</strong>
                          <span className="secondaryText">{run.processSpecKey}</span>
                          <span className="secondaryText clampLine">{run.planReason}</span>
                        </div>
                      </td>
                      <td>
                        <div className="cellStack">
                          <span className="monoText">{shortSha(run.commitSha)}</span>
                          <span className="secondaryText">
                            {run.changedFiles.length} changed files
                          </span>
                        </div>
                      </td>
                      <td>{run.trigger}</td>
                      <td>
                        <div className="cellStack">
                          <span>{run.branch ?? "No branch"}</span>
                          <span className="secondaryText">
                            {run.pullRequestNumber ? `PR #${run.pullRequestNumber}` : "No PR"}
                          </span>
                        </div>
                      </td>
                      <td>{classifyExecutionMode(run)}</td>
                      <td>
                        <div className="cellStack">
                          <span>{formatDateTime(run.createdAt)}</span>
                          <span className="secondaryText">{formatRelativeTime(run.createdAt)}</span>
                        </div>
                      </td>
                      <td>{formatDuration(run.startedAt, run.finishedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="paginationBar">
              <div className="secondaryText">
                Page {runsPage.page} of {totalPages}
              </div>
              <div className="paginationActions">
                <button
                  className="secondaryButton"
                  disabled={runsPage.page <= 1}
                  onClick={() => onPageChange(runsPage.page - 1)}
                >
                  Previous
                </button>
                <button
                  className="secondaryButton"
                  disabled={runsPage.page >= totalPages}
                  onClick={() => onPageChange(runsPage.page + 1)}
                >
                  Next
                </button>
              </div>
            </footer>
          </>
        ) : (
          <EmptyState title="No runs matched" body="Change the filters or trigger a new run." />
        )}
      </section>
    </div>
  );
};

const RunDetailPage = ({
  run,
  request,
}: {
  run: RunDetail | null;
  request: RunRequestDetail | null;
}) => {
  if (!run) {
    return <EmptyState title="Loading run" body="Fetching run detail, processes, and evidence." />;
  }

  return (
    <div className="pageStack">
      <section className="pageHeader">
        <div>
          <h1>{run.processSpecDisplayName}</h1>
          <p className="pageIntro">{run.planReason}</p>
        </div>
        <div className="badgeRow">
          <StatusPill status={run.status} />
          <span className="subtleBadge">{classifyExecutionMode(run)}</span>
          <span className="subtleBadge">{run.processSpecKey}</span>
        </div>
      </section>

      <section className="summaryGrid">
        <div className="summaryCard">
          <span className="summaryLabel">Run id</span>
          <strong className="monoText">{shortSha(run.id)}</strong>
          <span className="summaryMeta">{run.id}</span>
        </div>
        <div className="summaryCard">
          <span className="summaryLabel">Commit</span>
          <strong className="monoText">{request ? shortSha(request.commitSha) : "Loading"}</strong>
          <span className="summaryMeta">{request?.branch ?? "No branch"}</span>
        </div>
        <div className="summaryCard">
          <span className="summaryLabel">Trigger</span>
          <strong>{request?.trigger ?? "Loading"}</strong>
          <span className="summaryMeta">
            {request?.pullRequestNumber ? `PR #${request.pullRequestNumber}` : "No PR"}
          </span>
        </div>
        <div className="summaryCard">
          <span className="summaryLabel">Duration</span>
          <strong>{formatDuration(run.startedAt, run.finishedAt)}</strong>
          <span className="summaryMeta">
            {run.startedAt
              ? `${formatDateTime(run.startedAt)} to ${formatDateTime(run.finishedAt)}`
              : "Pending"}
          </span>
        </div>
      </section>

      <section className="panel tablePanel">
        <header className="panelHeader">
          <h2>Processes</h2>
        </header>
        <div className="tableScroller">
          <table className="dataTable">
            <thead>
              <tr>
                <th>Process</th>
                <th>Type</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {run.processes.map((process) => (
                <tr key={process.id}>
                  <td>
                    <div className="cellStack">
                      <strong>{process.processLabel}</strong>
                      <span className="secondaryText">{process.processKey}</span>
                    </div>
                  </td>
                  <td>{process.processType}</td>
                  <td>
                    <StatusPill status={process.status} />
                  </td>
                  <td>{process.attemptCount}</td>
                  <td>{formatDateTime(process.startedAt)}</td>
                  <td>{formatDateTime(process.finishedAt)}</td>
                  <td>{formatDuration(process.startedAt, process.finishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="twoColumnLayout">
        <article className="panel">
          <header className="panelHeader">
            <h2>Events</h2>
          </header>
          {run.events.length ? (
            <div className="stackList">
              {run.events.map((event) => (
                <div className="timelineItem" key={event.id}>
                  <div className="timelineMeta">
                    <StatusPill status={event.kind} />
                    <span className="secondaryText">{formatDateTime(event.createdAt)}</span>
                  </div>
                  <strong>{event.message}</strong>
                  {Object.keys(event.payload).length > 0 ? (
                    <pre className="codeBlock">{JSON.stringify(event.payload, null, 2)}</pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No events" body="This run has not emitted any lifecycle events." />
          )}
        </article>

        <article className="panel">
          <header className="panelHeader">
            <h2>Observations</h2>
          </header>
          {run.observations.length ? (
            <div className="stackList">
              {run.observations.map((observation) => (
                <div className="entityCard" key={observation.id}>
                  <div className="entityHeader">
                    <div>
                      <strong>{observation.processKey ?? "run"}</strong>
                      <span className="secondaryText">
                        {observation.areaKey ?? "no area"} ·{" "}
                        {formatDateTime(observation.observedAt)}
                      </span>
                    </div>
                    <StatusPill status={observation.status} />
                  </div>
                  <pre className="codeBlock">{JSON.stringify(observation.summary, null, 2)}</pre>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No observations"
              body="This run has not recorded any observations yet."
            />
          )}
        </article>
      </section>

      <section className="twoColumnLayout">
        <article className="panel">
          <header className="panelHeader">
            <h2>Artifacts</h2>
          </header>
          {run.artifacts.length ? (
            <div className="stackList">
              {run.artifacts.map((artifact) => (
                <div className="entityCard" key={artifact.id}>
                  <div className="entityHeader">
                    <div>
                      <strong>{artifact.artifactKey}</strong>
                      <span className="secondaryText">{artifact.mediaType}</span>
                    </div>
                    <span className="secondaryText">{formatDateTime(artifact.createdAt)}</span>
                  </div>
                  <div className="infoGrid">
                    <div>
                      <span className="infoLabel">Storage path</span>
                      <div className="monoText breakText">{artifact.storagePath}</div>
                    </div>
                    <div>
                      <span className="infoLabel">Process id</span>
                      <div className="monoText breakText">
                        {artifact.runProcessId ?? "run-level"}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No artifacts" body="This run has not stored any artifacts." />
          )}
        </article>

        <article className="panel">
          <header className="panelHeader">
            <h2>Checkpoints</h2>
          </header>
          {run.checkpoints.length ? (
            <div className="stackList">
              {run.checkpoints.map((checkpoint) => (
                <div className="entityCard" key={checkpoint.id}>
                  <div className="entityHeader">
                    <div>
                      <strong>{formatDateTime(checkpoint.createdAt)}</strong>
                      <span className="secondaryText">
                        resumable until {formatDateTime(checkpoint.resumableUntil)}
                      </span>
                    </div>
                  </div>
                  <div className="infoGrid">
                    <div>
                      <span className="infoLabel">Completed</span>
                      <div>{checkpoint.completedProcessKeys.join(", ") || "none"}</div>
                    </div>
                    <div>
                      <span className="infoLabel">Pending</span>
                      <div>{checkpoint.pendingProcessKeys.join(", ") || "none"}</div>
                    </div>
                    <div className="span2">
                      <span className="infoLabel">Storage path</span>
                      <div className="monoText breakText">{checkpoint.storagePath ?? "none"}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No checkpoints" body="This run has no saved checkpoint state." />
          )}
        </article>
      </section>

      {request ? (
        <section className="panel">
          <header className="panelHeader">
            <h2>Trigger context</h2>
          </header>
          <div className="infoGrid">
            <div>
              <span className="infoLabel">Request id</span>
              <div className="monoText breakText">{request.id}</div>
            </div>
            <div>
              <span className="infoLabel">Repository</span>
              <div>{request.repositorySlug}</div>
            </div>
            <div>
              <span className="infoLabel">Created</span>
              <div>{formatDateTime(request.createdAt)}</div>
            </div>
            <div>
              <span className="infoLabel">Status</span>
              <div>{request.status}</div>
            </div>
            <div className="span2">
              <span className="infoLabel">Changed files</span>
              <div className="codeList">
                {request.changedFiles.length ? request.changedFiles.join("\n") : "No changed files"}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
};

export const App = () => {
  const [route, setRoute] = useState<AppRoute>(parseRoute());
  const [health, setHealth] = useState<RepositoryHealth | null>(null);
  const [processSpecs, setProcessSpecs] = useState<ProcessSpecSummary[]>([]);
  const [runsPage, setRunsPage] = useState<PaginatedRunList | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<RunRequestDetail | null>(null);
  const [commitSha, setCommitSha] = useState("");
  const [branch, setBranch] = useState("main");
  const [changedFiles, setChangedFiles] = useState("");
  const [resumeFromCheckpoint, setResumeFromCheckpoint] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState(() =>
    route.name === "runs"
      ? {
          status: route.status,
          trigger: route.trigger,
          processSpecKey: route.processSpecKey,
        }
      : { status: "", trigger: "", processSpecKey: "" },
  );

  useEffect(() => {
    const syncRoute = (): void => setRoute(parseRoute());
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    if (route.name !== "runs") {
      return;
    }

    setDraftFilters({
      status: route.status,
      trigger: route.trigger,
      processSpecKey: route.processSpecKey,
    });
  }, [route]);

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
        setError(nextError instanceof Error ? nextError.message : "Failed to load overview");
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (route.name !== "runs") {
      setRunsPage(null);
      return;
    }

    setRunsPage(null);

    const refresh = async (): Promise<void> => {
      try {
        const search = new URLSearchParams({
          page: String(route.page),
          pageSize: "20",
        });

        if (route.status) {
          search.set("status", route.status);
        }
        if (route.trigger) {
          search.set("trigger", route.trigger);
        }
        if (route.processSpecKey) {
          search.set("processSpecKey", route.processSpecKey);
        }

        const nextRunsPage = await fetchJson<PaginatedRunList>(
          `/repositories/verge/runs?${search.toString()}`,
        );
        setRunsPage(nextRunsPage);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to load runs");
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => window.clearInterval(interval);
  }, [route]);

  useEffect(() => {
    if (route.name !== "run") {
      setSelectedRun(null);
      setSelectedRequest(null);
      return;
    }

    setSelectedRun(null);
    setSelectedRequest(null);

    const refresh = async (): Promise<void> => {
      try {
        const run = await fetchJson<RunDetail>(`/runs/${route.runId}`);
        setSelectedRun(run);
        const request = await fetchJson<RunRequestDetail>(`/run-requests/${run.runRequestId}`);
        setSelectedRequest(request);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to load run detail");
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [route]);

  const activeRunCount = useMemo(() => health?.activeRuns.length ?? 0, [health]);

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
        navigate(`/runs/${response.runIds[0]}`);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to start run");
    } finally {
      setSubmitting(false);
    }
  };

  const applyRunFilters = (): void => {
    const search = new URLSearchParams();
    if (draftFilters.status) {
      search.set("status", draftFilters.status);
    }
    if (draftFilters.trigger) {
      search.set("trigger", draftFilters.trigger);
    }
    if (draftFilters.processSpecKey) {
      search.set("processSpecKey", draftFilters.processSpecKey);
    }
    search.set("page", "1");
    navigate(`/runs?${search.toString()}`);
  };

  const changeRunsPage = (page: number): void => {
    if (route.name !== "runs") {
      return;
    }

    const search = new URLSearchParams();
    if (route.status) {
      search.set("status", route.status);
    }
    if (route.trigger) {
      search.set("trigger", route.trigger);
    }
    if (route.processSpecKey) {
      search.set("processSpecKey", route.processSpecKey);
    }
    search.set("page", String(page));
    navigate(`/runs?${search.toString()}`);
  };

  return (
    <main className="appShell">
      <header className="topbar">
        <div className="brandBlock">
          <div className="brandMark">V</div>
          <div>
            <div className="brandName">Verge</div>
            <div className="secondaryText">Repository control plane</div>
          </div>
        </div>
        <nav className="topnav">
          <NavLink active={route.name === "overview"} href="/" label="Overview" />
          <NavLink active={route.name === "runs"} href="/runs" label="Runs" />
        </nav>
        <div className="topbarMeta">
          <StatusPill status={activeRunCount > 0 ? "running" : "passed"} />
          <span className="secondaryText">{activeRunCount} active</span>
        </div>
      </header>

      {route.name === "overview" ? (
        <OverviewPage
          health={health}
          processSpecs={processSpecs}
          error={error}
          commitSha={commitSha}
          branch={branch}
          changedFiles={changedFiles}
          resumeFromCheckpoint={resumeFromCheckpoint}
          submitting={submitting}
          onCommitShaChange={setCommitSha}
          onBranchChange={setBranch}
          onChangedFilesChange={setChangedFiles}
          onResumeFromCheckpointChange={setResumeFromCheckpoint}
          onSubmit={() => void submitManualRun()}
        />
      ) : null}

      {route.name === "runs" ? (
        <RunsPage
          runsPage={runsPage}
          processSpecs={processSpecs}
          draftFilters={draftFilters}
          onDraftFilterChange={(key, value) => {
            setDraftFilters((current) => ({ ...current, [key]: value }));
          }}
          onApplyFilters={applyRunFilters}
          onPageChange={changeRunsPage}
        />
      ) : null}

      {route.name === "run" ? <RunDetailPage run={selectedRun} request={selectedRequest} /> : null}
    </main>
  );
};
