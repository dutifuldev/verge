import type { RunDetail } from "@verge/contracts";

import { EmptyState, StatusPill } from "../components/common.js";
import {
  classifyStepExecutionMode,
  formatDateTime,
  formatDuration,
  shortSha,
  summarizeRunExecutionMode,
} from "../lib/format.js";
import { navigate } from "../lib/routing.js";

export const RunDetailPage = ({ run, error }: { run: RunDetail | null; error: string | null }) => {
  if (!run) {
    return (
      <EmptyState
        title={error ? "Run unavailable" : "Loading run"}
        body={error ?? "Fetching run detail and step summaries."}
      />
    );
  }

  return (
    <div className="pageStack">
      <section className="pageHeader">
        <div>
          <h1>Run {shortSha(run.commitSha)}</h1>
          <p className="pageIntro">
            {run.trigger} trigger with {run.steps.length} steps and {run.changedFiles.length}{" "}
            changed files.
          </p>
        </div>
        <div className="badgeRow">
          <StatusPill status={run.status} />
          <span className="subtleBadge">{summarizeRunExecutionMode(run.steps)}</span>
          <span className="subtleBadge">{run.steps.length} steps</span>
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
          <strong className="monoText">{shortSha(run.commitSha)}</strong>
          <span className="summaryMeta">{run.branch ?? "No branch"}</span>
        </div>
        <div className="summaryCard">
          <span className="summaryLabel">Trigger</span>
          <strong>{run.trigger}</strong>
          <span className="summaryMeta">
            {run.pullRequestNumber ? `PR #${run.pullRequestNumber}` : "No PR"}
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
          <h2>Steps</h2>
        </header>
        <div className="tableScroller">
          <table className="dataTable">
            <thead>
              <tr>
                <th>Step</th>
                <th>Status</th>
                <th>Execution</th>
                <th>Processes</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Duration</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {run.steps.map((step) => (
                <tr key={step.id}>
                  <td>
                    <div className="cellStack">
                      <strong>{step.stepDisplayName}</strong>
                      <span className="secondaryText">{step.stepKey}</span>
                      <span className="secondaryText clampLine">{step.planReason}</span>
                    </div>
                  </td>
                  <td>
                    <StatusPill status={step.status} />
                  </td>
                  <td>{classifyStepExecutionMode(step)}</td>
                  <td>{step.processCount}</td>
                  <td>{formatDateTime(step.startedAt)}</td>
                  <td>{formatDateTime(step.finishedAt)}</td>
                  <td>{formatDuration(step.startedAt, step.finishedAt)}</td>
                  <td>
                    <a
                      className="tableLink"
                      href={`/runs/${run.id}/steps/${step.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(`/runs/${run.id}/steps/${step.id}`);
                      }}
                    >
                      Open step
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <header className="panelHeader">
          <h2>Trigger context</h2>
        </header>
        <div className="infoGrid">
          <div>
            <span className="infoLabel">Run id</span>
            <div className="monoText breakText">{run.id}</div>
          </div>
          <div>
            <span className="infoLabel">Repository</span>
            <div>{run.repositorySlug}</div>
          </div>
          <div>
            <span className="infoLabel">Created</span>
            <div>{formatDateTime(run.createdAt)}</div>
          </div>
          <div>
            <span className="infoLabel">Status</span>
            <div>{run.status}</div>
          </div>
          <div className="span2">
            <span className="infoLabel">Changed files</span>
            <div className="codeList">
              {run.changedFiles.length ? run.changedFiles.join("\n") : "No changed files"}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
