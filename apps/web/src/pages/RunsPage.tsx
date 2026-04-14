import type { PaginatedRunList, StepSpecSummary } from "@verge/contracts";

import { EmptyState, StatusPill } from "../components/common.js";
import {
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  summarizeRunExecutionMode,
  summarizeRunSteps,
  shortSha,
} from "../lib/format.js";
import { buildCommitPath, buildRunPath, navigate } from "../lib/routing.js";

export const RunsPage = ({
  repositorySlug,
  runsPage,
  processSpecs,
  commitSha,
  branch,
  changedFiles,
  resumeFromCheckpoint,
  submitting,
  draftFilters,
  onCommitShaChange,
  onBranchChange,
  onChangedFilesChange,
  onResumeFromCheckpointChange,
  onSubmit,
  onDraftFilterChange,
  onApplyFilters,
  onPageChange,
}: {
  repositorySlug: string | null;
  runsPage: PaginatedRunList | null;
  processSpecs: StepSpecSummary[];
  commitSha: string;
  branch: string;
  changedFiles: string;
  resumeFromCheckpoint: boolean;
  submitting: boolean;
  draftFilters: { status: string; trigger: string; stepKey: string };
  onCommitShaChange: (value: string) => void;
  onBranchChange: (value: string) => void;
  onChangedFilesChange: (value: string) => void;
  onResumeFromCheckpointChange: (value: boolean) => void;
  onSubmit: () => void;
  onDraftFilterChange: (key: "status" | "trigger" | "stepKey", value: string) => void;
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
            One row per top-level run. Open a run to inspect the steps and processes inside it.
          </p>
        </div>
      </section>

      <section className="panel">
        <header className="panelHeader">
          <div>
            <h2>Create a run</h2>
            <p className="secondaryText">
              Manual runs live here so the repository landing page can stay focused on commits.
            </p>
          </div>
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
            <span>Step</span>
            <select
              value={draftFilters.stepKey}
              onChange={(event) => onDraftFilterChange("stepKey", event.target.value)}
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
                    <th>Commit</th>
                    <th>Trigger</th>
                    <th>Ref</th>
                    <th>Steps</th>
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
                      onClick={() => {
                        const targetRepositorySlug = repositorySlug ?? run.repositorySlug;
                        navigate(buildRunPath(targetRepositorySlug, run.id));
                      }}
                    >
                      <td>
                        <StatusPill status={run.status} />
                      </td>
                      <td>
                        <div className="cellStack">
                          <a
                            className="tableLink monoText"
                            href={buildCommitPath(run.repositorySlug, run.commitSha)}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              navigate(buildCommitPath(run.repositorySlug, run.commitSha));
                            }}
                          >
                            {shortSha(run.commitSha)}
                          </a>
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
                      <td>
                        <div className="cellStack">
                          <strong>{run.steps.length} steps</strong>
                          <span className="secondaryText clampLine">
                            {summarizeRunSteps(run.steps)}
                          </span>
                        </div>
                      </td>
                      <td>{summarizeRunExecutionMode(run.steps)}</td>
                      <td>
                        <div className="cellStack">
                          <span>{formatDateTime(run.createdAt)}</span>
                          <span className="secondaryText">{formatRelativeTime(run.createdAt)}</span>
                        </div>
                      </td>
                      <td>{formatDuration(run.startedAt, run.finishedAt, run.durationMs)}</td>
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
