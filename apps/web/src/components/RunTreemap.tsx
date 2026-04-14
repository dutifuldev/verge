import {
  hierarchy,
  treemap,
  type HierarchyNode,
  type HierarchyRectangularNode,
} from "d3-hierarchy";
import { useState } from "react";

import type { CommitTreemap, RunTreemap, TreemapNode } from "@verge/contracts";

import { EmptyState, StatusPill } from "./common.js";
import { formatDurationMs, statusTone } from "../lib/format.js";
import { navigate } from "../lib/routing.js";

const treemapWidth = 1200;
const treemapHeight = 520;
type TreemapLayoutNode = HierarchyRectangularNode<TreemapNode>;

const nodePaddingTop = (depth: number): number => {
  if (depth === 1) {
    return 28;
  }

  if (depth === 2) {
    return 22;
  }

  return 0;
};

const shouldShowLabel = (node: TreemapLayoutNode): boolean => {
  const width = node.x1 - node.x0;
  const height = node.y1 - node.y0;

  if (node.data.kind === "step") {
    return width >= 120 && height >= 48;
  }

  if (node.data.kind === "file") {
    return width >= 100 && height >= 42;
  }

  return width >= 124 && height >= 48;
};

const buildTreemapLayout = (tree: TreemapNode): TreemapLayoutNode => {
  const root = hierarchy(tree)
    .sum((node: TreemapNode) => node.valueMs)
    .sort(
      (left: HierarchyNode<TreemapNode>, right: HierarchyNode<TreemapNode>) =>
        (right.value ?? 0) - (left.value ?? 0),
    );

  return treemap<TreemapNode>()
    .size([treemapWidth, treemapHeight])
    .paddingOuter(8)
    .paddingInner(4)
    .paddingTop((node: TreemapLayoutNode) => (node.depth > 0 ? nodePaddingTop(node.depth) : 0))(
    root,
  );
};

type TreemapData = Pick<RunTreemap, "tree"> | Pick<CommitTreemap, "tree">;

export const TreemapView = ({
  treeData,
  treemapError,
  errorTitle,
  loadingTitle,
  loadingBody,
  emptyTitle,
  emptyBody,
  ariaLabel,
  buildNodePath,
}: {
  treeData: TreemapData | null;
  treemapError: string | null;
  errorTitle: string;
  loadingTitle: string;
  loadingBody: string;
  emptyTitle: string;
  emptyBody: string;
  ariaLabel: string;
  buildNodePath?: (node: TreemapNode) => string | null;
}) => {
  const [hoveredNode, setHoveredNode] = useState<{
    node: TreemapNode;
    x: number;
    y: number;
  } | null>(null);

  if (!treeData) {
    return (
      <EmptyState
        title={treemapError ? errorTitle : loadingTitle}
        body={treemapError ?? loadingBody}
      />
    );
  }

  if (!treeData.tree.children?.length || treeData.tree.valueMs === 0) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }

  const root = buildTreemapLayout(treeData.tree);
  const renderedNodes = root.descendants().filter((node: TreemapLayoutNode) => node.depth > 0);

  return (
    <div className="treemapSection">
      <div className="treemapLegend">
        {["passed", "failed", "reused", "running", "queued", "interrupted"].map((status) => (
          <span className={`treemapLegendItem ${statusTone(status)}`} key={status}>
            <span className={`treemapLegendSwatch ${status}`} />
            {status}
          </span>
        ))}
      </div>
      <div className="treemapWrap">
        <svg
          aria-label={ariaLabel}
          className="treemapSvg"
          role="img"
          viewBox={`0 0 ${treemapWidth} ${treemapHeight}`}
        >
          {renderedNodes.map((node) => {
            const width = node.x1 - node.x0;
            const height = node.y1 - node.y0;
            const targetPath = buildNodePath?.(node.data) ?? null;

            return (
              <g
                className={`treemapNode treemapDepth${node.depth}`}
                key={node.data.id}
                transform={`translate(${node.x0},${node.y0})`}
              >
                <rect
                  className={`treemapNodeRect status-${node.data.status}`}
                  height={Math.max(0, height)}
                  rx={node.data.kind === "process" ? 4 : 8}
                  ry={node.data.kind === "process" ? 4 : 8}
                  width={Math.max(0, width)}
                  onClick={() => {
                    if (targetPath) {
                      navigate(targetPath);
                    }
                  }}
                  onMouseEnter={(event) => {
                    setHoveredNode({
                      node: node.data,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onMouseLeave={() => setHoveredNode(null)}
                  onMouseMove={(event) => {
                    setHoveredNode((current) =>
                      current
                        ? {
                            ...current,
                            x: event.clientX,
                            y: event.clientY,
                          }
                        : current,
                    );
                  }}
                />
                {shouldShowLabel(node) ? (
                  <text className={`treemapLabel depth-${node.depth}`} x={10} y={20}>
                    {node.data.label}
                  </text>
                ) : null}
                {shouldShowLabel(node) && node.data.kind !== "step" ? (
                  <text className="treemapMeta" x={10} y={38}>
                    {formatDurationMs(node.data.valueMs)}
                  </text>
                ) : null}
                {shouldShowLabel(node) && node.data.kind === "step" ? (
                  <text className="treemapMeta" x={10} y={44}>
                    {formatDurationMs(node.data.valueMs)} process time
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {hoveredNode ? (
          <div
            className="treemapTooltip"
            style={{
              left: hoveredNode.x + 16,
              top: hoveredNode.y + 16,
            }}
          >
            <div className="treemapTooltipHeader">
              <strong>{hoveredNode.node.label}</strong>
              <StatusPill status={hoveredNode.node.status} />
            </div>
            <div className="treemapTooltipGrid">
              <span className="infoLabel">Process time</span>
              <span>{formatDurationMs(hoveredNode.node.valueMs)}</span>
              <span className="infoLabel">Wall time</span>
              <span>{formatDurationMs(hoveredNode.node.wallDurationMs)}</span>
              <span className="infoLabel">Kind</span>
              <span>{hoveredNode.node.kind}</span>
              {hoveredNode.node.filePath ? (
                <>
                  <span className="infoLabel">File</span>
                  <span className="monoText breakText">{hoveredNode.node.filePath}</span>
                </>
              ) : null}
              {hoveredNode.node.processKey ? (
                <>
                  <span className="infoLabel">Process key</span>
                  <span className="monoText breakText">{hoveredNode.node.processKey}</span>
                </>
              ) : null}
              {hoveredNode.node.attemptCount !== null ? (
                <>
                  <span className="infoLabel">Attempts</span>
                  <span>{hoveredNode.node.attemptCount}</span>
                </>
              ) : null}
              {hoveredNode.node.reused ? (
                <>
                  <span className="infoLabel">Execution</span>
                  <span>reused</span>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const RunTreemapView = TreemapView;
