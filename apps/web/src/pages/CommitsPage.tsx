import type { PaginatedCommitList } from "@verge/contracts";

import { CopyButton, EmptyState, StatusPill } from "../components/common.js";
import { formatRelativeTime, shortSha } from "../lib/format.js";
import { buildCommitPath, navigate } from "../lib/routing.js";

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
        <h1>Commits</h1>
      </section>

      <section className="plainTableSection">
        {commitsPage?.items.length ? (
          <>
            <div className="tableScroller tableScrollerBare">
              <table className="dataTable">
                <thead>
                  <tr>
                    <th>Commit</th>
                    <th>Coverage</th>
                    <th>Status</th>
                    <th>Attempts</th>
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
                          <strong>{commit.commitTitle ?? shortSha(commit.commitSha)}</strong>
                          <div className="commitMetaLine secondaryText">
                            <span>{commit.commitAuthorName ?? "Unknown author"}</span>
                            <span>
                              {formatRelativeTime(commit.committedAt ?? commit.latestCreatedAt)}
                            </span>
                            <span className="monoText">{shortSha(commit.commitSha)}</span>
                            <CopyButton value={commit.commitSha} label="Copy" />
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="coverageCell">
                          <strong>{commit.coveragePercent}%</strong>
                          <span className="secondaryText">
                            {commit.coveredProcessCount} / {commit.expectedProcessCount} processes
                          </span>
                        </div>
                      </td>
                      <td>
                        <StatusPill status={commit.status} />
                      </td>
                      <td>
                        <div className="cellStack">
                          <strong>{commit.attemptCount}</strong>
                          <span className="secondaryText">
                            {commit.healthyProcessCount} healthy selected
                          </span>
                        </div>
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
