const cornerRadiusCache = new Map();

const ALPHA_THRESHOLD = 128;
const MAX_ANALYSIS_SIZE = 1024;
const CORNER_SAMPLE_RATIO = 0.25;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getCornerBoundary(alpha, width, height, limit, fromRight, fromBottom) {
  const boundary = [];

  for (let y = 0; y <= limit; y += 1) {
    const pixelY = fromBottom ? height - 1 - y : y;
    let firstOpaqueX = null;

    for (let x = 0; x <= limit; x += 1) {
      const pixelX = fromRight ? width - 1 - x : x;
      if (alpha[(pixelY * width + pixelX) * 4 + 3] >= ALPHA_THRESHOLD) {
        firstOpaqueX = x;
        break;
      }
    }

    boundary.push(firstOpaqueX);
  }

  return boundary;
}

function fitCircularCorner(boundary, limit) {
  const lastCurvedRow = boundary.reduce((last, x, y) => (x !== null && x > 0 ? y : last), 0);
  const sampleEnd = Math.min(limit, Math.max(8, Math.ceil(lastCurvedRow * 1.25)));
  let bestRadius = 0;
  let bestError = Number.POSITIVE_INFINITY;

  for (let radius = 0; radius <= limit; radius += 0.25) {
    let error = 0;
    let sampleCount = 0;

    for (let y = 0; y <= sampleEnd; y += 1) {
      const measuredX = boundary[y];
      if (measuredX === null) continue;

      const predictedX =
        radius > 0 && y < radius
          ? radius - Math.sqrt(Math.max(0, radius ** 2 - (radius - y) ** 2))
          : 0;
      error += Math.abs(measuredX - predictedX);
      sampleCount += 1;
    }

    if (sampleCount && error / sampleCount < bestError) {
      bestError = error / sampleCount;
      bestRadius = radius;
    }
  }

  return bestRadius;
}

/**
 * Measures the rounded transparent corners baked into a card image.
 * Returns the radius as a ratio of the image's natural width so it can be
 * reapplied at any rendered size without hard-coded breakpoints.
 */
export function measureImageCornerRadiusRatio(image) {
  if (!image?.naturalWidth || !image?.naturalHeight) return 0;

  const cacheKey = image.currentSrc || image.src;
  if (cacheKey && cornerRadiusCache.has(cacheKey)) return cornerRadiusCache.get(cacheKey);

  try {
    const analysisScale = Math.min(
      1,
      MAX_ANALYSIS_SIZE / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * analysisScale));
    const height = Math.max(1, Math.round(image.naturalHeight * analysisScale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return 0;

    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const limit = Math.max(1, Math.floor(Math.min(width, height) * CORNER_SAMPLE_RATIO));
    const corners = [
      getCornerBoundary(pixels, width, height, limit, false, false),
      getCornerBoundary(pixels, width, height, limit, true, false),
      getCornerBoundary(pixels, width, height, limit, false, true),
      getCornerBoundary(pixels, width, height, limit, true, true),
    ];
    const radii = corners.map((boundary) => fitCircularCorner(boundary, limit));
    const ratio = median(radii) / width;

    if (cacheKey) cornerRadiusCache.set(cacheKey, ratio);
    return ratio;
  } catch {
    return 0;
  }
}
