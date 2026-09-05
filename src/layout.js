const PANEL_DIRECTIONS = Object.freeze(["down", "up", "right", "left"]);
const LAUNCHER_CORNERS = new Set(["bottom-left", "bottom-right", "top-left", "top-right"]);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegative(value, fallback) {
  return Math.max(0, finiteNumber(value, fallback));
}

function clamp(value, minimum, maximum) {
  if (maximum < minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function launcherMetrics(options = {}) {
  const viewportWidth = nonNegative(options.viewportWidth, 0);
  const viewportHeight = nonNegative(options.viewportHeight, 0);
  const viewportLeft = finiteNumber(options.viewportLeft, 0);
  const viewportTop = finiteNumber(options.viewportTop, 0);
  const margin = nonNegative(options.margin, 12);
  const launcherSize = nonNegative(options.launcherSize, 48);
  return {
    viewportWidth,
    viewportHeight,
    viewportLeft,
    viewportTop,
    margin,
    launcherSize,
    minX: viewportLeft + margin,
    maxX: viewportLeft + viewportWidth - margin - launcherSize,
    minY: viewportTop + margin,
    maxY: viewportTop + viewportHeight - margin - launcherSize,
  };
}

/** Keep a launcher's top-left pixel coordinate inside the viewport margin. */
export function clampLauncherPixels(pixels, options = {}) {
  const metrics = launcherMetrics(options);
  const source = pixels && typeof pixels === "object" ? pixels : {};
  return {
    x: clamp(finiteNumber(source.x, metrics.minX), metrics.minX, metrics.maxX),
    y: clamp(finiteNumber(source.y, metrics.minY), metrics.minY, metrics.maxY),
  };
}

/** Resolve one of the four persisted launcher corners to viewport pixels. */
export function launcherCornerToPixels(corner, options = {}) {
  const metrics = launcherMetrics(options);
  const resolvedCorner = LAUNCHER_CORNERS.has(corner) ? corner : "bottom-right";
  const compact = metrics.viewportWidth <= 720;
  const horizontalOffset = nonNegative(options.horizontalOffset, compact ? 10 : 18);
  // Leave the top corners below Bilibili's fixed navigation instead of merely
  // hugging the visual viewport edge.
  const topOffset = nonNegative(options.topOffset, compact ? 68 : 76);
  const bottomOffset = nonNegative(options.bottomOffset, compact ? 12 : 22);
  const onLeft = resolvedCorner.endsWith("left");
  const onTop = resolvedCorner.startsWith("top");
  return clampLauncherPixels({
    x: onLeft
      ? metrics.viewportLeft + horizontalOffset
      : metrics.viewportLeft + metrics.viewportWidth - horizontalOffset - metrics.launcherSize,
    y: onTop
      ? metrics.viewportTop + topOffset
      : metrics.viewportTop + metrics.viewportHeight - bottomOffset - metrics.launcherSize,
  }, options);
}

function panelCandidate(direction, anchor, panelWidth, panelHeight, gap) {
  const anchorRight = anchor.left + anchor.width;
  const anchorBottom = anchor.top + anchor.height;
  if (direction === "up") {
    return {
      left: anchor.left + (anchor.width - panelWidth) / 2,
      top: anchor.top - gap - panelHeight,
    };
  }
  if (direction === "left") {
    return {
      left: anchor.left - gap - panelWidth,
      top: anchor.top + (anchor.height - panelHeight) / 2,
    };
  }
  if (direction === "right") {
    return {
      left: anchorRight + gap,
      top: anchor.top + (anchor.height - panelHeight) / 2,
    };
  }
  return {
    left: anchor.left + (anchor.width - panelWidth) / 2,
    top: anchorBottom + gap,
  };
}

/**
 * Place a panel around an anchor. An explicit direction is preferred while it
 * fits; otherwise the direction with the most usable primary-axis space wins.
 */
export function placePanel({
  direction = "auto",
  anchor = {},
  panelWidth,
  panelHeight,
  viewportWidth,
  viewportHeight,
  viewportLeft = 0,
  viewportTop = 0,
  margin = 10,
  gap = 10,
} = {}) {
  const safeMargin = nonNegative(margin, 10);
  const safeGap = nonNegative(gap, 10);
  const safePanelWidth = nonNegative(panelWidth, 0);
  const safePanelHeight = nonNegative(panelHeight, 0);
  const safeViewportWidth = nonNegative(viewportWidth, 0);
  const safeViewportHeight = nonNegative(viewportHeight, 0);
  const safeViewportLeft = finiteNumber(viewportLeft, 0);
  const safeViewportTop = finiteNumber(viewportTop, 0);
  const viewportRight = safeViewportLeft + safeViewportWidth;
  const viewportBottom = safeViewportTop + safeViewportHeight;
  const safeAnchor = {
    left: finiteNumber(anchor?.left, 0),
    top: finiteNumber(anchor?.top, 0),
    width: nonNegative(anchor?.width, 0),
    height: nonNegative(anchor?.height, 0),
  };
  const anchorRight = safeAnchor.left + safeAnchor.width;
  const anchorBottom = safeAnchor.top + safeAnchor.height;
  const available = {
    up: safeAnchor.top - (safeViewportTop + safeMargin) - safeGap,
    down: viewportBottom - safeMargin - safeGap - anchorBottom,
    left: safeAnchor.left - (safeViewportLeft + safeMargin) - safeGap,
    right: viewportRight - safeMargin - safeGap - anchorRight,
  };
  const required = {
    up: safePanelHeight,
    down: safePanelHeight,
    left: safePanelWidth,
    right: safePanelWidth,
  };
  const requested = PANEL_DIRECTIONS.includes(direction) ? direction : null;
  let chosen = requested && available[requested] >= required[requested]
    ? requested
    : PANEL_DIRECTIONS.reduce((best, candidate) => {
      const candidateFits = available[candidate] >= required[candidate];
      const bestFits = available[best] >= required[best];
      if (candidateFits !== bestFits) return candidateFits ? candidate : best;
      const candidateRatio = required[candidate] > 0
        ? available[candidate] / required[candidate]
        : available[candidate];
      const bestRatio = required[best] > 0
        ? available[best] / required[best]
        : available[best];
      return candidateRatio > bestRatio ? candidate : best;
    }, PANEL_DIRECTIONS[0]);

  const candidate = panelCandidate(
    chosen,
    safeAnchor,
    safePanelWidth,
    safePanelHeight,
    safeGap,
  );
  return {
    left: clamp(candidate.left, safeViewportLeft + safeMargin, viewportRight - safeMargin - safePanelWidth),
    top: clamp(candidate.top, safeViewportTop + safeMargin, viewportBottom - safeMargin - safePanelHeight),
    direction: chosen,
  };
}
