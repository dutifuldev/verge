import type { PaginatedCommitList } from "@verge/contracts";

import { EmptyState, StatusPill } from "../components/common.js";
import { formatRelativeTime } from "../lib/format.js";
import { buildCommitPath, buildRepositoryRunsPath, navigate } from "../lib/routing.js";

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

export const CommitsPage = ({
  repositorySlug,
  commitsPage,
  onPageChange,
}: {
  repositorySlug: string | null;
  commitsPage: PaginatedCommitList | null;
  onPageChange: (page: number) => void;
}) => {
  const totalPages = commitsPage
    ? Math.max(1, Math.ceil(commitsPage.total / commitsPage.pageSize))
    : 1;

  return (
    <div className="pageStack">
      <section className="pageHeader">
        <div>
          <h1>Commits</h1>
          <p className="pageIntro">
            One row per commit. Open a commit to inspect its converged health and the attempts that
            produced it.
          </p>
        </div>
      </section>

      <section className="panel tablePanel">
        <header className="panelHeader">
          <div>
            <h2>Commit health</h2>
            <p className="secondaryText">
              This is the primary repository view. Runs stay available as secondary attempt history.
            </p>
          </div>
          {repositorySlug ? (
            <a
              className="panelLink"
              href={buildRepositoryRunsPath(repositorySlug)}
              onClick={(event) => {
                event.preventDefault();
                navigate(buildRepositoryRunsPath(repositorySlug));
              }}
            >
              Open runs history
            </a>
          ) : null}
        </header>
        {commitsPage?.items.length ? (
          <>
            <div className="tableScroller">
              <table className="dataTable">
                <thead>
                  <tr>
                    <th>Commit</th>
                    <th>Status</th>
                    <th>Coverage</th>
                    <th>Attempts</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {commitsPage.items.map((commit) => (
                    <tr
                      key={commit.commitSha}
                      className="clickableRow"
                      onClick={() => {
                        const targetRepositorySlug = repositorySlug ?? commit.repositorySlug;
                        if (!targetRepositorySlug) {
                          return;
                        }

                        navigate(buildCommitPath(targetRepositorySlug, commit.commitSha));
                      }}
                    >
                      <td>
                        <div className="cellStack">
                          <strong>
                            {commit.commitTitle ?? `Commit ${commit.commitSha.slice(0, 7)}`}
                          </strong>
                          <span className="secondaryText monoText">
                            {commit.commitSha.slice(0, 7)}
                          </span>
                        </div>
                      </td>
                      <td>
                        <StatusPill status={commit.status} />
                      </td>
                      <td>
                        <div className="coverageCell">
                          <div className="coverageMeta">
                            <strong>{commit.coveragePercent}%</strong>
                            <span className="secondaryText">
                              {commit.coveredProcessCount} / {commit.expectedProcessCount} processes
                            </span>
                          </div>
                          <div className="coverageBar" aria-hidden="true">
                            <div
                              className="coverageFill"
                              style={{ width: `${clampPercent(commit.coveragePercent)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="cellStack">
                          <strong>{commit.attemptCount}</strong>
                          <span className="secondaryText">
                            {commit.healthyProcessCount} healthy selected
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="secondaryText">
                          {formatRelativeTime(commit.latestCreatedAt)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="paginationBar">
              <div className="secondaryText">
                Page {commitsPage.page} of {totalPages}
              </div>
              <div className="paginationActions">
                <button
                  className="secondaryButton"
                  disabled={commitsPage.page <= 1}
                  onClick={() => onPageChange(commitsPage.page - 1)}
                >
                  Previous
                </button>
                <button
                  className="secondaryButton"
                  disabled={commitsPage.page >= totalPages}
                  onClick={() => onPageChange(commitsPage.page + 1)}
                >
                  Next
                </button>
              </div>
            </footer>
          </>
        ) : (
          <EmptyState
            title="No commits yet"
            body="Push a commit or create a manual run to populate commit health."
          />
        )}
      </section>
    </div>
  );
};
