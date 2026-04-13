import { useDeferredValue, useEffect, useState } from "react";

import type { RunDetail, StepRunDetail } from "@verge/contracts";

import { EmptyState, StatusPill } from "../components/common.js";
import {
  classifyStepExecutionMode,
  formatDateTime,
  formatDuration,
  shortSha,
} from "../lib/format.js";
import { buildRunPath, navigate } from "../lib/routing.js";

export const StepDetailPage = ({
  run,
  step,
  error,
}: {
  run: RunDetail | null;
  step: StepRunDetail | null;
  error: string | null;
}) => {
  const [processQuery, setProcessQuery] = useState("");
  const deferredProcessQuery = useDeferredValue(processQuery);

  useEffect(() => {
    setProcessQuery("");
  }, [step?.id]);

  if (!run || !step) {
    return (
      <EmptyState
        title={error ? "Step unavailable" : "Loading step"}
        body={error ?? "Fetching step detail and process data."}
      />
    );
  }

  const normalizedQuery = deferredProcessQuery.trim().toLowerCase();
  const visibleProcesses = step.processes.filter((process) => {
    if (!normalizedQuery) {
      return true;
    }

    return [
      process.processDisplayName,
      process.processKey,
      process.processKind,
      process.filePath ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });

  return (
    <div className="pageStack">
      <section className="pageHeader">
        <div>
          <h1>{step.stepDisplayName}</h1>
          <p className="pageIntro">
            Part of run {shortSha(run.commitSha)}. This page contains the processes, events,
            observations, artifacts, and checkpoints for one step.
          </p>
        </div>
        <div className="badgeRow">
          <StatusPill status={step.status} />
          <span className="subtleBadge">{classifyStepExecutionMode(step)}</span>
          <span className="subtleBadge">{step.stepKey}</span>
        </div>
      </section>

      <section className="panel">
        <header className="panelHeader">
          <h2>Context</h2>
          <a
            className="panelLink"
            href={buildRunPath(run.repositorySlug, run.id)}
            onClick={(event) => {
              event.preventDefault();
              navigate(buildRunPath(run.repositorySlug, run.id));
            }}
          >
            Back to run
          </a>
        </header>
        <div className="infoGrid">
          <div>
            <span className="infoLabel">Run</span>
            <div className="monoText breakText">{run.id}</div>
          </div>
          <div>
            <span className="infoLabel">Commit</span>
            <div className="monoText">{shortSha(run.commitSha)}</div>
          </div>
          <div>
            <span className="infoLabel">Trigger</span>
            <div>{run.trigger}</div>
          </div>
          <div>
            <span className="infoLabel">Processes</span>
            <div>{step.processes.length}</div>
          </div>
        </div>
      </section>

      <section className="panel tablePanel">
        <header className="panelHeader">
          <h2>Processes</h2>
          <span className="secondaryText">
            {visibleProcesses.length} of {step.processes.length}
          </span>
        </header>
        <div className="panelSection">
          <label className="field">
            <span>Filter processes</span>
            <input
              value={processQuery}
              onChange={(event) => setProcessQuery(event.target.value)}
              placeholder="Search by test name, file path, key, or status"
            />
          </label>
        </div>
        <div className="tableScroller">
          <table className="dataTable">
            <thead>
              <tr>
                <th>Process</th>
                <th>File</th>
                <th>Type</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {visibleProcesses.map((process) => (
                <tr key={process.id}>
                  <td>
                    <strong>{process.processDisplayName}</strong>
                  </td>
                  <td className="monoText">{process.filePath ?? "No file"}</td>
                  <td>{process.processKind}</td>
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
        {visibleProcesses.length === 0 ? (
          <div className="panelSection">
            <EmptyState
              title="No processes matched"
              body="Change the filter to see processes for this step."
            />
          </div>
        ) : null}
      </section>

      <section className="twoColumnLayout">
        <article className="panel">
          <header className="panelHeader">
            <h2>Events</h2>
          </header>
          {step.events.length ? (
            <div className="stackList">
              {step.events.map((event) => (
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
            <EmptyState title="No events" body="This step has not emitted any lifecycle events." />
          )}
        </article>

        <article className="panel">
          <header className="panelHeader">
            <h2>Observations</h2>
          </header>
          {step.observations.length ? (
            <div className="stackList">
              {step.observations.map((observation) => (
                <div className="entityCard" key={observation.id}>
                  <div className="entityHeader">
                    <div>
                      <strong>{observation.processKey ?? "step"}</strong>
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
              body="This step has not recorded any observations yet."
            />
          )}
        </article>
      </section>

      <section className="twoColumnLayout">
        <article className="panel">
          <header className="panelHeader">
            <h2>Artifacts</h2>
          </header>
          {step.artifacts.length ? (
            <div className="stackList">
              {step.artifacts.map((artifact) => (
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
                        {artifact.processRunId ?? "step-level"}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No artifacts" body="This step has not stored any artifacts." />
          )}
        </article>

        <article className="panel">
          <header className="panelHeader">
            <h2>Checkpoints</h2>
          </header>
          {step.checkpoints.length ? (
            <div className="stackList">
              {step.checkpoints.map((checkpoint) => (
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
            <EmptyState title="No checkpoints" body="This step has no saved checkpoint state." />
          )}
        </article>
      </section>
    </div>
  );
};
