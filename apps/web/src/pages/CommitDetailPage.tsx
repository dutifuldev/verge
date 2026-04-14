import type { CommitDetail, CommitTreemap } from "@verge/contracts";

import { EmptyState, StatusPill } from "../components/common.js";
import { TreemapView } from "../components/RunTreemap.js";
import {
  formatDateTime,
  formatDuration,
  formatDurationMs,
  formatRelativeTime,
  shortSha,
  summarizeRunExecutionMode,
  summarizeRunSteps,
} from "../lib/format.js";
import { buildRunPath, buildStepPath, navigate } from "../lib/routing.js";

export const CommitDetailPage = ({
  commit,
  treemap,
  treemapError,
  error,
}: {
  commit: CommitDetail | null;
  treemap: CommitTreemap | null;
  treemapError: string | null;
  error: string | null;
}) => {
  if (!commit) {
    return (
      <EmptyState
        title={error ? "Commit unavailable" : "Loading commit"}
        body={error ?? "Fetching the converged commit state and attempt history."}
      />
    );
  }

  return (
    <div className="pageStack">
      <section className="pageHeader">
        <div>
          <h1>Commit {shortSha(commit.commitSha)}</h1>
          <p className="pageIntro">
            This page shows the converged health for one commit across all runs, plus the attempt
            history that produced it.
          </p>
        </div>
        <div className="badgeRow">
          <StatusPill status={commit.status} />
          <span className="subtleBadge">{commit.steps.length} steps</span>
          <span className="subtleBadge">{commit.processes.length} processes</span>
          <span className="subtleBadge">{commit.runs.length} attempts</span>
        </div>
      </section>

      <section className="summaryGrid">
        <div className="summaryCard">
          <span className="summaryLabel">Commit</span>
          <strong className="monoText">{shortSha(commit.commitSha)}</strong>
          <span className="summaryMeta breakText">{commit.commitSha}</span>
        </div>
        <div className="summaryCard">
          <span className="summaryLabel">Selected process time</span>
          <strong>{formatDurationMs(commit.executionCost.selectedProcessDurationMs)}</strong>
          <span className="summaryMeta">Used for the converged duration map</span>
        </div>
        <div className="summaryCard">
          <span className="summaryLabel">Execution cost</span>
          <strong>{formatDurationMs(commit.executionCost.totalExecutionDurationMs)}</strong>
          <span className="summaryMeta">
            {commit.executionCost.processRunCount} process runs across{" "}
            {commit.executionCost.runCount} attempts
          </span>
        </div>
        <div className="summaryCard">
          <span className="summaryLabel">Current health</span>
          <strong>{commit.status}</strong>
          <span className="summaryMeta">Selected from the latest evidence per process</span>
        </div>
      </section>

      <section className="panel">
        <header className="panelHeader">
          <div>
            <h2>Commit duration map</h2>
            <p className="secondaryText">
              Area shows the selected process duration for this commit. Color shows the converged
              status of each step and process.
            </p>
          </div>
        </header>
        <TreemapView
          treeData={treemap}
          treemapError={treemapError}
          errorTitle="Commit duration map unavailable"
          loadingTitle="Loading commit duration map"
          loadingBody="Fetching the converged commit treemap and process duration breakdown."
          emptyTitle="No commit duration map yet"
          emptyBody="The treemap appears once this commit has selected process duration."
          ariaLabel="Commit duration treemap"
          buildNodePath={(node) => {
            if (
              node.kind === "process" &&
              node.sourceRunId &&
              node.sourceStepRunId &&
              node.sourceProcessRunId
            ) {
              return `${buildStepPath(
                commit.repositorySlug,
                node.sourceRunId,
                node.sourceStepRunId,
              )}#process-${node.sourceProcessRunId}`;
            }

            if (node.kind === "file" && node.sourceRunId && node.sourceStepRunId) {
              return buildStepPath(commit.repositorySlug, node.sourceRunId, node.sourceStepRunId);
            }

            return null;
          }}
        />
      </section>

      <section className="panel tablePanel">
        <header className="panelHeader">
          <h2>Steps</h2>
          <span className="secondaryText">{commit.steps.length} converged step states</span>
        </header>
        <div className="tableScroller">
          <table className="dataTable">
            <thead>
              <tr>
                <th>Step</th>
                <th>Status</th>
                <th>Processes</th>
                <th>Selected time</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {commit.steps.map((step) => (
                <tr key={step.stepKey} id={`commit-step-${step.stepKey}`}>
                  <td>
                    <div className="cellStack">
                      <strong>{step.stepDisplayName}</strong>
                      <span className="secondaryText">{step.stepKey}</span>
                    </div>
                  </td>
                  <td>
                    <StatusPill status={step.status} />
                  </td>
                  <td>{step.processCount}</td>
                  <td>{formatDurationMs(step.durationMs)}</td>
                  <td>
                    {step.sourceRunId && step.sourceStepRunId ? (
                      <a
                        className="tableLink"
                        href={buildStepPath(
                          commit.repositorySlug,
                          step.sourceRunId,
                          step.sourceStepRunId,
                        )}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(
                            buildStepPath(
                              commit.repositorySlug,
                              step.sourceRunId!,
                              step.sourceStepRunId!,
                            ),
                          );
                        }}
                      >
                        Open source step
                      </a>
                    ) : (
                      <span className="secondaryText">No source step</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel tablePanel">
        <header className="panelHeader">
          <h2>Processes</h2>
          <span className="secondaryText">{commit.processes.length} converged process states</span>
        </header>
        <div className="tableScroller">
          <table className="dataTable">
            <thead>
              <tr>
                <th>Process</th>
                <th>Step</th>
                <th>File</th>
                <th>Status</th>
                <th>Selected time</th>
                <th>Attempts</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {commit.processes.map((process) => (
                <tr key={`${process.stepKey}:${process.processKey}`}>
                  <td>
                    <div className="cellStack">
                      <strong>{process.processDisplayName}</strong>
                      <span className="secondaryText monoText breakText">{process.processKey}</span>
                    </div>
                  </td>
                  <td>
                    <div className="cellStack">
                      <strong>{process.stepDisplayName}</strong>
                      <span className="secondaryText">{process.stepKey}</span>
                    </div>
                  </td>
                  <td className="monoText breakText">{process.filePath ?? "No file"}</td>
                  <td>
                    <StatusPill status={process.status} />
                  </td>
                  <td>{formatDurationMs(process.durationMs)}</td>
                  <td>{process.attemptCount}</td>
                  <td>
                    <a
                      className="tableLink"
                      href={`${buildStepPath(
                        commit.repositorySlug,
                        process.sourceRunId,
                        process.sourceStepRunId,
                      )}#process-${process.sourceProcessRunId}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(
                          `${buildStepPath(
                            commit.repositorySlug,
                            process.sourceRunId,
                            process.sourceStepRunId,
                          )}#process-${process.sourceProcessRunId}`,
                        );
                      }}
                    >
                      Open source process
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel tablePanel">
        <header className="panelHeader">
          <h2>Attempt history</h2>
          <span className="secondaryText">{commit.runs.length} runs contributed to this view</span>
        </header>
        <div className="tableScroller">
          <table className="dataTable">
            <thead>
              <tr>
                <th>Status</th>
                <th>Trigger</th>
                <th>Ref</th>
                <th>Steps</th>
                <th>Execution</th>
                <th>Created</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {commit.runs.map((run) => (
                <tr
                  key={run.id}
                  className="clickableRow"
                  onClick={() => navigate(buildRunPath(commit.repositorySlug, run.id))}
                >
                  <td>
                    <StatusPill status={run.status} />
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
      </section>
    </div>
  );
};
