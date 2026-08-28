/**
 * Manifest and card image loading.
 */

import { state } from '../state.js';

const imageCache = new Map();
const imageLoads = new Map();
const manifestCache = new Map();
const manifestLoads = new Map();

function loadImage(url) {
  if (imageCache.has(url)) return Promise.resolve(imageCache.get(url));
  if (imageLoads.has(url)) return imageLoads.get(url);

  const promise = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const result = {
        ok: true,
        width: image.naturalWidth,
        height: image.naturalHeight,
        src: url,
      };
      imageCache.set(url, result);
      imageLoads.delete(url);
      resolve(result);
    };
    image.onerror = () => {
      imageLoads.delete(url);
      resolve({ ok: false, src: url });
    };
    image.src = url;
  });

  imageLoads.set(url, promise);
  return promise;
}

export function fetchManifest(basePath) {
  if (!basePath) return Promise.resolve(null);
  if (manifestCache.has(basePath)) return Promise.resolve(manifestCache.get(basePath));
  if (manifestLoads.has(basePath)) return manifestLoads.get(basePath);

  const promise = fetch(`${basePath}/manifest.json`, { cache: 'no-cache' })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)
    .then((manifest) => {
      manifestLoads.delete(basePath);
      if (manifest) manifestCache.set(basePath, manifest);
      return manifest;
    });

  manifestLoads.set(basePath, promise);
  return promise;
}

function buildCardImageUrl(prefix, cardNo) {
  const format = state.manifest?.image_format;
  if (!state.basePath || !format) return '';

  const path = `${state.basePath}/${prefix}${cardNo}.${format}`;
  const version = state.manifest.asset_version;
  return version ? `${path}?v=${encodeURIComponent(version)}` : path;
}

function loadCardImage(prefix, cardNo) {
  const url = buildCardImageUrl(prefix, cardNo);
  return url ? loadImage(url) : Promise.resolve({ ok: false, src: '' });
}

export function loadFrontImage(cardNo) {
  return loadCardImage('front', cardNo);
}

export function loadBackImage(cardNo) {
  return loadCardImage('back', cardNo);
}
