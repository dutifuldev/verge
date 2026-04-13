import type { RepositoryHealth, StepSpecSummary } from "@verge/contracts";

import { EmptyState, StatusPill } from "../components/common.js";
import { formatRelativeTime, shortSha, shouldShowSecondaryKey } from "../lib/format.js";
import { navigate } from "../lib/routing.js";

export const OverviewPage = ({
  health,
  processSpecs,
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
  processSpecs: StepSpecSummary[];
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
            Track the current repository state, active work, and recent runs without collapsing
            everything into one mixed dashboard.
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
            <span className="summaryLabel">Step specs</span>
            <strong>{processSpecs.length}</strong>
            <span className="summaryMeta">Registered for this repository</span>
          </div>
        </div>
      </section>

      <section className="twoColumnLayout">
        <article className="panel">
          <header className="panelHeader">
            <h2>Create a run</h2>
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
                    <strong>{shortSha(run.commitSha)}</strong>
                    <span className="secondaryText">
                      {run.trigger} · {formatRelativeTime(run.createdAt)}
                    </span>
                  </div>
                  <div className="rowMeta">
                    <StatusPill status={run.status} />
                    <span className="secondaryText">{run.steps.length} steps</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No runs yet"
              body="Push a commit or create a manual run to see results here."
            />
          )}
        </article>
      </section>
    </div>
  );
};
