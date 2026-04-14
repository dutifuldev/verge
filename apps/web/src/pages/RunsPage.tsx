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
  draftFilters,
  onDraftFilterChange,
  onApplyFilters,
  onPageChange,
}: {
  repositorySlug: string | null;
  runsPage: PaginatedRunList | null;
  processSpecs: StepSpecSummary[];
  draftFilters: { status: string; trigger: string; stepKey: string };
  onDraftFilterChange: (key: "status" | "trigger" | "stepKey", value: string) => void;
  onApplyFilters: () => void;
  onPageChange: (page: number) => void;
}) => {
  const totalPages = runsPage ? Math.max(1, Math.ceil(runsPage.total / runsPage.pageSize)) : 1;

  return (
    <div className="pageStack">
      <section className="pageHeader">
        <h1>Runs</h1>
      </section>

      <section className="plainTableSection">
        {runsPage?.items.length ? (
          <>
            <div className="tableScroller tableScrollerBare">
              <table className="dataTable">
                <thead>
                  <tr className="tableControlsRow">
                    <th colSpan={8}>
                      <div className="tableControlsBar">
                        <div className="tableControlsLabel">Browse runs</div>
                        <div className="tableControlsGroup">
                          <label className="headerFilter">
                            <span>Status</span>
                            <select
                              value={draftFilters.status}
                              onChange={(event) =>
                                onDraftFilterChange("status", event.target.value)
                              }
                            >
                              <option value="">All</option>
                              {[
                                "passed",
                                "failed",
                                "running",
                                "queued",
                                "reused",
                                "interrupted",
                              ].map((value) => (
                                <option key={value} value={value}>
                                  {value}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="headerFilter">
                            <span>Trigger</span>
                            <select
                              value={draftFilters.trigger}
                              onChange={(event) =>
                                onDraftFilterChange("trigger", event.target.value)
                              }
                            >
                              <option value="">All</option>
                              {["manual", "push", "pull_request"].map((value) => (
                                <option key={value} value={value}>
                                  {value}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="headerFilter">
                            <span>Step</span>
                            <select
                              value={draftFilters.stepKey}
                              onChange={(event) =>
                                onDraftFilterChange("stepKey", event.target.value)
                              }
                            >
                              <option value="">All</option>
                              {processSpecs.map((spec) => (
                                <option key={spec.id} value={spec.key}>
                                  {spec.displayName}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            className="secondaryButton compactButton"
                            onClick={onApplyFilters}
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    </th>
                  </tr>
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
          <EmptyState title="No runs matched" body="Change the filters or wait for new attempts." />
        )}
      </section>
    </div>
  );
};
