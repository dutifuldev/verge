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
const horizontalPadding = 10;

type NodeTextContent = {
  primary: string | null;
  secondary: string | null;
};

const nodePaddingTop = (depth: number): number => {
  if (depth === 1) {
    return 28;
  }

  if (depth === 2) {
    return 22;
  }

  return 0;
};

const ellipsize = (value: string, maxChars: number): string | null => {
  if (maxChars <= 0) {
    return null;
  }

  if (value.length <= maxChars) {
    return value;
  }

  if (maxChars <= 1) {
    return null;
  }

  return `${value.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
};

const basename = (value: string): string => {
  const segments = value.split("/");
  return segments.at(-1) ?? value;
};

const compactProcessLabel = (value: string): string => {
  const segments = value
    .split(" > ")
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.at(-1) ?? value;
};

const maxCharactersForWidth = (width: number, charWidth: number): number =>
  Math.floor(width / charWidth);

const buildNodeTextContent = (node: TreemapLayoutNode): NodeTextContent => {
  const width = node.x1 - node.x0;
  const height = node.y1 - node.y0;
  const textWidth = Math.max(0, width - horizontalPadding * 2);

  if (node.data.kind === "step") {
    if (width < 96 || height < 40) {
      return { primary: null, secondary: null };
    }

    return {
      primary: ellipsize(node.data.label, maxCharactersForWidth(textWidth, 7.1)),
      secondary:
        width >= 150 && height >= 56
          ? ellipsize(
              `${formatDurationMs(node.data.valueMs)} process time`,
              maxCharactersForWidth(textWidth, 6.2),
            )
          : null,
    };
  }

  if (node.data.kind === "file") {
    if (width < 90 || height < 36) {
      return { primary: null, secondary: null };
    }

    const fileLabel = basename(node.data.filePath ?? node.data.label);

    return {
      primary: ellipsize(fileLabel, maxCharactersForWidth(textWidth, 6.9)),
      secondary:
        width >= 136 && height >= 48
          ? ellipsize(formatDurationMs(node.data.valueMs), maxCharactersForWidth(textWidth, 6.1))
          : null,
    };
  }

  if (width < 110 || height < 28) {
    return { primary: null, secondary: null };
  }

  const processLabel = compactProcessLabel(node.data.label);
  const primary = ellipsize(
    processLabel,
    maxCharactersForWidth(textWidth, width >= 180 ? 6.8 : 6.3),
  );

  return {
    primary,
    secondary:
      primary && width >= 164 && height >= 44
        ? ellipsize(formatDurationMs(node.data.valueMs), maxCharactersForWidth(textWidth, 6.1))
        : null,
  };
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
          {renderedNodes.map((node, index) => {
            const width = node.x1 - node.x0;
            const height = node.y1 - node.y0;
            const targetPath = buildNodePath?.(node.data) ?? null;
            const text = buildNodeTextContent(node);
            const clipPathId = `treemap-clip-${index}`;

            return (
              <g
                className={`treemapNode treemapDepth${node.depth}`}
                key={node.data.id}
                transform={`translate(${node.x0},${node.y0})`}
              >
                {text.primary || text.secondary ? (
                  <defs>
                    <clipPath id={clipPathId}>
                      <rect
                        height={Math.max(0, height - 8)}
                        rx={node.data.kind === "process" ? 4 : 8}
                        ry={node.data.kind === "process" ? 4 : 8}
                        width={Math.max(0, width - horizontalPadding * 2)}
                        x={horizontalPadding}
                        y={6}
                      />
                    </clipPath>
                  </defs>
                ) : null}
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
                {text.primary ? (
                  <text
                    className={`treemapLabel depth-${node.depth}`}
                    clipPath={`url(#${clipPathId})`}
                    x={horizontalPadding}
                    y={20}
                  >
                    {text.primary}
                  </text>
                ) : null}
                {text.secondary ? (
                  <text
                    className="treemapMeta"
                    clipPath={`url(#${clipPathId})`}
                    x={horizontalPadding}
                    y={node.data.kind === "step" ? 44 : 38}
                  >
                    {text.secondary}
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
