/**
 * Chapter discovery and loading.
 */

import { state } from '../state.js';
import { CHAPTER_PREFIX, CHAPTER_SUFFIX, MAX_CHAPTERS_PROBE } from '../config.js';
import { fetchManifest } from '../core/image-loader.js';
import { getStoredCard, loadHistory, loadRevisionProgress } from '../core/storage.js';
import { asPositiveInt, qs } from '../utils/helpers.js';
import { rebuildDeck, resetFastNavState, ensureShuffleQueue } from './navigation.js';
import {
  showCurrent,
  showSkeleton,
  hideSkeleton,
  updateNavButtons,
  updateFavouritesCount,
} from '../ui/updates.js';
import { resetRevisionProgress } from './revision-mode.js';

function chapterName(chapterNo) {
  return `${CHAPTER_PREFIX}${chapterNo}${CHAPTER_SUFFIX}`;
}

function chapterPath(chapterNo) {
  return `flashcards/${chapterName(chapterNo)}`;
}

function cardGroupMatches(group, field, perCard, totalCards) {
  if (!group || typeof group !== 'object') return false;

  const groupedCards = Object.entries(group).flatMap(([value, cards]) => {
    if (!Array.isArray(cards)) return [null];
    return cards.map((cardNo) =>
      Number.isInteger(cardNo) && perCard[String(cardNo)]?.[field] === value ? cardNo : null
    );
  });
  return (
    groupedCards.length === totalCards &&
    groupedCards.every(Boolean) &&
    new Set(groupedCards).size === totalCards
  );
}

function getManifestError(manifest, expectedChapter) {
  if (!manifest || typeof manifest !== 'object') return 'manifest absent ou illisible';
  if (manifest.chapter !== expectedChapter) return `chapter doit valoir "${expectedChapter}"`;
  if (typeof manifest.asset_version !== 'string' || !manifest.asset_version.trim()) {
    return 'asset_version est requis';
  }
  if (typeof manifest.image_format !== 'string' || !/^[a-z0-9]+$/i.test(manifest.image_format)) {
    return 'image_format est invalide';
  }

  const totalCards = manifest.total_cards;
  if (!Number.isInteger(totalCards) || totalCards < 1) return 'total_cards doit être positif';
  if (!manifest.per_card || typeof manifest.per_card !== 'object') return 'per_card est requis';

  for (let cardNo = 1; cardNo <= totalCards; cardNo++) {
    const card = manifest.per_card[String(cardNo)];
    const frontWidth = asPositiveInt(card?.front?.width);
    const frontHeight = asPositiveInt(card?.front?.height);
    const backWidth = asPositiveInt(card?.back?.width);
    const backHeight = asPositiveInt(card?.back?.height);
    if (
      !card ||
      typeof card.border !== 'string' ||
      typeof card.timer !== 'string' ||
      !frontWidth ||
      !frontHeight ||
      !backWidth ||
      !backHeight
    ) {
      return `per_card.${cardNo} est incomplet`;
    }
  }

  if (Object.keys(manifest.per_card).length !== totalCards) {
    return 'per_card doit contenir exactement total_cards entrées';
  }
  if (!cardGroupMatches(manifest.cards_by_border, 'border', manifest.per_card, totalCards)) {
    return 'cards_by_border est invalide';
  }
  if (!cardGroupMatches(manifest.cards_by_timer, 'timer', manifest.per_card, totalCards)) {
    return 'cards_by_timer est invalide';
  }
  return null;
}

export async function discoverChapters() {
  const found = [];
  const batchSize = 5;

  for (let start = 1; start <= MAX_CHAPTERS_PROBE; start += batchSize) {
    const chapterNumbers = Array.from(
      { length: Math.min(batchSize, MAX_CHAPTERS_PROBE - start + 1) },
      (_, index) => start + index
    );
    const manifests = await Promise.all(
      chapterNumbers.map((chapterNo) => fetchManifest(chapterPath(chapterNo)))
    );
    const validChapters = chapterNumbers.filter(
      (chapterNo, index) => !getManifestError(manifests[index], chapterName(chapterNo))
    );
    found.push(...validChapters);

    if (validChapters.length < chapterNumbers.length) break;
  }

  return found;
}

function applyManifest(manifest) {
  state.manifest = manifest;
  state.total = manifest.total_cards;
  state.sizes = {};

  for (let cardNo = 1; cardNo <= manifest.total_cards; cardNo++) {
    const { width, height } = manifest.per_card[String(cardNo)].front;
    state.sizes[cardNo] = { w: width, h: height };
  }
}

async function loadManifest() {
  const manifest = await fetchManifest(state.basePath);
  const error = getManifestError(manifest, chapterName(state.chapter));
  if (error) throw new Error(`Manifest ${state.basePath}: ${error}`);
  applyManifest(manifest);
}

export async function loadChapter(chapterNo) {
  const chapterSelect = qs('#chapterSelect');
  if (chapterSelect) chapterSelect.disabled = true;

  try {
    await loadChapterContent(chapterNo);
  } catch (error) {
    state.total = 0;
    state.deck = [];
    state.manifest = null;
    hideSkeleton();
    qs('#counter').textContent = 'Chapitre indisponible : manifest invalide.';
    updateNavButtons();
    console.error(error);
  } finally {
    if (chapterSelect) chapterSelect.disabled = false;
  }
}

async function loadChapterContent(chapterNo) {
  showSkeleton();
  state.chapter = chapterNo;
  state.basePath = chapterPath(chapterNo);
  state.deck = [];
  state.history = [];
  state.historyIndex = -1;
  state.currentIndex = 0;
  state.unvisited.clear();
  state.shuffleQueue = [];
  state.imagesLoaded.clear();
  state.preloading.clear();
  resetFastNavState();
  updateFavouritesCount();

  if (state.revisionMode) {
    const progress = loadRevisionProgress();
    if (progress) {
      state.revisionRound = progress.round;
      state.revisionIncorrect = progress.incorrect;
      state.revisionSeen = progress.seen;
      state.revisionMastered = progress.mastered;
    } else {
      resetRevisionProgress();
    }
  }

  await loadManifest();
  const storedCard = getStoredCard(state.chapter);
  rebuildDeck(storedCard);

  if (state.revisionMode && state.revisionRound > 1 && state.revisionIncorrect.size > 0) {
    state.deck = state.deck.filter((card) => state.revisionIncorrect.has(card));
  }

  if (!state.deck.length) {
    hideSkeleton();
    qs('#counter').textContent = 'Aucune carte disponible.';
    updateNavButtons();
    return;
  }

  if (state.shuffle) {
    const savedHistory = loadHistory();
    const initialCard = storedCard && state.deck.includes(storedCard) ? storedCard : null;

    if (savedHistory.length > 0) {
      state.history = savedHistory;
    } else if (initialCard) {
      state.history = [initialCard];
    } else {
      state.history = [state.deck[Math.floor(Math.random() * state.deck.length)]];
    }

    state.historyIndex = state.history.length - 1;
    state.unvisited = new Set(state.deck);
    state.history.forEach((card) => state.unvisited.delete(card));
  } else {
    state.currentIndex =
      storedCard && state.deck.includes(storedCard) ? state.deck.indexOf(storedCard) : 0;
  }

  ensureShuffleQueue();
  await showCurrent();
}
