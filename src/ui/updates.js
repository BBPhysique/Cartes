/**
 * UI state synchronization and updates
 */

import { state, getCurrentCard, getCurrentRevisionDeck } from '../state.js';
import { TIMER_STATES, DIFFICULTY_STATES } from '../config.js';
import { qs, waitAnimationEnd } from '../utils/helpers.js';
import { UMAMI_EVENTS, trackUmamiEvent } from '../utils/analytics.js';
import { loadFrontImage, loadBackImage } from '../core/image-loader.js';
import { loadFavourites } from '../core/storage.js';
import { storeCurrentCard } from '../core/storage.js';
import { preloadNearbyCards } from '../core/preloader.js';
import { processNavQueue, rebuildDeck } from '../features/navigation.js';
import { resetSwipeTransform } from './card-motion.js';

// ==================== Modal State ====================

let modalScrollY = 0;
let modalLockActive = false;

function updateModalOpenState() {
  if (!document.body) return;
  const hasOpenModal = Boolean(qs('.modal.show'));
  if (hasOpenModal && !modalLockActive) {
    modalScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = `-${modalScrollY}px`;
    document.body.classList.add('modal-open');
    modalLockActive = true;
  } else if (!hasOpenModal && modalLockActive) {
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    window.scrollTo(0, modalScrollY);
    modalLockActive = false;
  }
}

export function setModalVisibility(modal, shouldShow) {
  if (!modal) return;
  modal.classList.toggle('show', shouldShow);
  updateModalOpenState();
}

// ==================== Skeleton ====================

export function showSkeleton() {
  const skeleton = qs('#skeleton');
  const stage = qs('#stage');
  const cardShell = qs('#cardShell');
  skeleton.classList.remove('empty');
  skeleton.classList.add('visible');
  skeleton.setAttribute('aria-hidden', 'true');
  stage?.classList.remove('is-empty');
  cardShell?.removeAttribute('aria-hidden');
  qs('#card3d')?.setAttribute('tabindex', '0');
}

export function hideSkeleton() {
  const skeleton = qs('#skeleton');
  skeleton.classList.remove('visible', 'empty');
  skeleton.setAttribute('aria-hidden', 'true');
  qs('#stage')?.classList.remove('is-empty');
  qs('#cardShell')?.removeAttribute('aria-hidden');
  qs('#card3d')?.setAttribute('tabindex', '0');
}

export function showEmptyState(message = 'Pas de résultat') {
  const skeleton = qs('#skeleton');
  const messageEl = qs('#emptyStateMessage');
  const cardShell = qs('#cardShell');

  resetCardFlip();
  if (messageEl) messageEl.textContent = message;
  qs('#stage')?.classList.add('is-empty');
  skeleton.classList.add('visible', 'empty');
  skeleton.setAttribute('aria-hidden', 'false');
  cardShell?.setAttribute('aria-hidden', 'true');
  qs('#card3d')?.setAttribute('tabindex', '-1');
  qs('#counter').textContent = '0 résultat';
  updateBookmarkButton();
  updateNavButtons();
}

// ==================== Stage Sizing ====================

export function sizeStageForImage(naturalW, naturalH) {
  const stage = qs('#stage');
  const maxWidth = Math.min(window.innerWidth * 0.9, 900);
  const availableHeight = window.innerHeight - 300;
  const maxHeight = Math.max(availableHeight, 200);

  const widthByHeight = maxHeight * (naturalW / naturalH);
  const finalWidth = Math.min(maxWidth, widthByHeight);
  const finalHeight = finalWidth * (naturalH / naturalW);

  stage.style.width = `${finalWidth}px`;
  stage.style.height = `${finalHeight}px`;
}

// ==================== Card Display ====================

const FLIP_DURATION_MS = 640;
let activeFlipAnimation = null;
let activeFlipCleanup = null;

function clearFlipTransition() {
  if (activeFlipCleanup) activeFlipCleanup();
  if (!activeFlipAnimation) return;

  const animation = activeFlipAnimation;
  activeFlipAnimation = null;
  animation.onfinish = null;
  animation.oncancel = null;
  animation.cancel();

  const card3d = qs('#card3d');
  card3d?.classList.remove('flipping', 'flip-animated');
  qs('#cardShell')?.classList.remove('is-flipping');
}

export function setFlipped(on) {
  if (!getCurrentCard()) return;
  if (state.flipped === on) return;

  state.flipped = on;
  trackUmamiEvent(UMAMI_EVENTS.cardFlip, {
    mode: state.revisionMode ? 'revision' : 'lecture',
    side: on ? 'back' : 'front',
  });
  const card3d = qs('#card3d');
  const cardShell = qs('#cardShell');

  if (activeFlipAnimation) {
    card3d.classList.toggle('flipped', on);
    card3d.setAttribute('aria-pressed', String(on));
    activeFlipAnimation.reverse();
    return;
  }

  clearFlipTransition();
  card3d.classList.add('flipping');
  cardShell.classList.add('is-flipping');

  if (typeof card3d.animate === 'function') {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card3d.classList.add('flip-animated');
    card3d.classList.toggle('flipped', on);
    card3d.setAttribute('aria-pressed', String(on));

    const animation = card3d.animate(
      [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }],
      {
        duration: reduceMotion ? 1 : FLIP_DURATION_MS,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        direction: on ? 'normal' : 'reverse',
        fill: 'both',
      }
    );
    activeFlipAnimation = animation;
    animation.onfinish = () => {
      if (activeFlipAnimation !== animation) return;
      activeFlipAnimation = null;
      animation.onfinish = null;
      animation.cancel();
      card3d.classList.remove('flipping', 'flip-animated');
      cardShell.classList.remove('is-flipping');
    };
    return;
  }

  const cleanup = () => {
    if (activeFlipCleanup !== cleanup) return;
    activeFlipCleanup = null;
    clearTimeout(fallbackTimer);
    card3d.removeEventListener('transitionend', onTransitionEnd);
    card3d.classList.remove('flipping');
    cardShell.classList.remove('is-flipping');
  };
  const onTransitionEnd = (event) => {
    if (event.target === card3d && event.propertyName === 'transform') cleanup();
  };

  activeFlipCleanup = cleanup;
  card3d.addEventListener('transitionend', onTransitionEnd);
  card3d.classList.toggle('flipped', on);
  card3d.setAttribute('aria-pressed', String(on));
  const fallbackTimer = setTimeout(cleanup, 700);
}

export function resetCardFlip() {
  const card3d = qs('#card3d');
  if (!card3d) return;

  clearFlipTransition();
  card3d.classList.add('no-anim');
  card3d.classList.remove('flipped', 'flipping');
  card3d.setAttribute('aria-pressed', 'false');
  qs('#cardShell')?.classList.remove('is-flipping');
  state.flipped = false;
  void card3d.offsetHeight;
  card3d.classList.remove('no-anim');
}

function getCardElements() {
  const cardShell = qs('#cardShell');
  const card3d = qs('#card3d');
  const frontImg = qs('#frontImg');
  const backImg = qs('#backImg');
  return { cardShell, card3d, frontImg, backImg };
}

function waitForImage(image) {
  if (image.complete) return Promise.resolve();
  return new Promise((resolve) => image.addEventListener('load', resolve, { once: true }));
}

async function loadCardAssets(cardNo) {
  return Promise.all([loadFrontImage(cardNo), loadBackImage(cardNo)]);
}

async function renderCard(cardNo, assets, elements) {
  const { card3d, frontImg, backImg } = elements;
  const [front, back] = assets;

  if (!front?.ok || !back?.ok) {
    throw new Error(`Unable to load both images for card ${cardNo}`);
  }

  if (state.flipped || card3d.classList.contains('flipping')) {
    resetCardFlip();
  }

  frontImg.classList.remove('loaded');
  backImg.classList.remove('loaded');

  const dimensions = front?.ok ? front : back;
  if (dimensions?.ok && dimensions.width && dimensions.height) {
    state.sizes[cardNo] = { w: dimensions.width, h: dimensions.height };
    sizeStageForImage(dimensions.width, dimensions.height);
  }

  frontImg.src = front?.src || '';
  backImg.src = back?.src || '';

  try {
    await Promise.all([frontImg.decode(), backImg.decode()]);
  } catch {
    await Promise.all([waitForImage(frontImg), waitForImage(backImg)]);
  }

  state.imagesLoaded.add(cardNo);
  frontImg.classList.add('loaded');
  backImg.classList.add('loaded');
  hideSkeleton();
  updateCounter();
  updateBookmarkButton();
}

async function runSlideTransition(direction, instant, renderTarget, elements) {
  const { cardShell } = elements;
  const outClass = direction === 'next' ? 'out-left' : 'out-right';
  const outName = direction === 'next' ? 'outLeft' : 'outRight';
  const inClass = direction === 'next' ? 'in-right' : 'in-left';
  const inName = direction === 'next' ? 'inRight' : 'inLeft';

  cardShell.classList.remove('out-left', 'out-right', 'in-left', 'in-right');
  void cardShell.offsetWidth;

  if (!instant) {
    cardShell.classList.add(outClass);
    await waitAnimationEnd(cardShell, outName, 400);
  }

  await renderTarget();
  cardShell.classList.remove(outClass);

  if (!instant) {
    void cardShell.offsetWidth;
    cardShell.classList.add(inClass);
    await waitAnimationEnd(cardShell, inName, 500);
    cardShell.classList.remove(inClass);
  }
}

let revisionEntranceCleanup = null;

function stopRevisionEntrance(cardShell) {
  if (revisionEntranceCleanup) {
    revisionEntranceCleanup();
    return;
  }
  cardShell.classList.remove('scaling-in');
  cardShell.style.transition = '';
}

function startRevisionEntrance(cardShell) {
  stopRevisionEntrance(cardShell);
  cardShell.classList.add('scaling-in');
  void cardShell.offsetWidth;
  cardShell.style.visibility = '';
  cardShell.style.opacity = '';

  let fallbackTimer = null;
  const cleanup = () => {
    if (revisionEntranceCleanup !== cleanup) return;
    revisionEntranceCleanup = null;
    clearTimeout(fallbackTimer);
    cardShell.removeEventListener('animationend', onAnimationEnd);
    cardShell.classList.remove('scaling-in');
    cardShell.style.transition = '';
  };
  const onAnimationEnd = (event) => {
    if (event.animationName === 'scaleIn') cleanup();
  };

  revisionEntranceCleanup = cleanup;
  cardShell.addEventListener('animationend', onAnimationEnd);
  fallbackTimer = setTimeout(cleanup, 500);
}

async function runRevisionTransition(direction, gestureStarted, renderTarget, elements) {
  const { cardShell } = elements;
  stopRevisionEntrance(cardShell);
  const exitClass = gestureStarted
    ? `swipe-exit-${direction}`
    : direction === 'right'
      ? 'swiping-right'
      : 'swiping-left';
  const exitName = gestureStarted
    ? direction === 'right'
      ? 'swipeExitRight'
      : 'swipeExitLeft'
    : direction === 'right'
      ? 'swipeRightOut'
      : 'swipeLeftOut';
  if (renderTarget) renderTarget(true);

  if (!gestureStarted) {
    resetSwipeTransform(cardShell);
    void cardShell.offsetWidth;
    cardShell.classList.add(exitClass);
  }

  await waitAnimationEnd(cardShell, exitName, gestureStarted ? 600 : 400);
  cardShell.style.transition = 'none';
  cardShell.style.opacity = '0';
  cardShell.style.visibility = 'hidden';
  cardShell.classList.remove(exitClass);
  resetSwipeTransform(cardShell);

  if (!renderTarget) return;

  await renderTarget(false, true);
  startRevisionEntrance(cardShell);
}

async function transitionCard({
  cardNo = getCurrentCard(),
  direction = 'none',
  instant = false,
  revisionDirection = null,
  gestureStarted = false,
  renderTarget = true,
} = {}) {
  if (state.isTransitioning || (renderTarget && !cardNo)) return false;

  const elements = getCardElements();
  if (Object.values(elements).some((element) => !element)) return false;

  const { cardShell } = elements;
  const chapterSelect = qs('#chapterSelect');
  const size = renderTarget ? state.sizes[cardNo] : null;

  if (size?.w > 0 && size?.h > 0) {
    sizeStageForImage(size.w, size.h);
  }

  if (
    renderTarget &&
    !revisionDirection &&
    (!state.imagesLoaded.has(cardNo) || qs('#stage')?.classList.contains('is-empty'))
  ) {
    showSkeleton();
  }

  state.isTransitioning = true;
  if (chapterSelect) chapterSelect.disabled = true;

  let assetsPromise = null;
  const render = async (preloadOnly = false, keepHidden = false) => {
    assetsPromise ||= loadCardAssets(cardNo);
    if (preloadOnly) return assetsPromise;
    const assets = await assetsPromise;
    await renderCard(cardNo, assets, elements);
    if (!keepHidden) {
      cardShell.style.opacity = '';
      cardShell.style.visibility = '';
      cardShell.style.transition = '';
    }
  };

  try {
    if (revisionDirection) {
      await runRevisionTransition(
        revisionDirection,
        gestureStarted,
        renderTarget ? render : null,
        elements
      );
    } else if (direction !== 'none') {
      await runSlideTransition(direction, instant, render, elements);
    } else {
      await render();
    }
    return true;
  } catch (error) {
    console.error('Card transition error:', error);
    cardShell.classList.remove(
      'out-left',
      'out-right',
      'in-left',
      'in-right',
      'swiping-left',
      'swiping-right',
      'scaling-in'
    );
    resetSwipeTransform(cardShell);
    cardShell.style.opacity = '';
    cardShell.style.visibility = '';
    cardShell.style.transition = '';
    return false;
  } finally {
    state.isTransitioning = false;
    if (chapterSelect) chapterSelect.disabled = false;
    if (renderTarget) {
      updateNavButtons();
      storeCurrentCard(cardNo);
      preloadNearbyCards();
    }
    processNavQueue();
  }
}

export function showCurrent(direction = 'none', options = {}) {
  return transitionCard({
    direction,
    instant: Boolean(options.instant),
    revisionDirection: options.revisionDirection || null,
    gestureStarted: Boolean(options.gestureStarted),
  });
}

export function exitCurrentCard(revisionDirection, options = {}) {
  return transitionCard({
    revisionDirection,
    gestureStarted: Boolean(options.gestureStarted),
    renderTarget: false,
  });
}

// ==================== Counter ====================

export function updateCounter() {
  const el = qs('#counter');
  if (!state.deck.length) {
    if (state.showFavouritesOnly) {
      el.textContent = 'Aucun favori disponible.';
    } else {
      el.textContent = 'Aucune image trouvée.';
    }
    return;
  }

  const currentCard = getCurrentCard();
  if (!currentCard) {
    el.textContent = 'Aucune carte sélectionnée.';
    return;
  }

  if (state.revisionMode) {
    const currentDeck = getCurrentRevisionDeck();
    const remaining = currentDeck.length - state.revisionSeen.size;
    const roundText = state.revisionRound > 1 ? `Tour ${state.revisionRound} · ` : '';
    if (remaining > 0) {
      el.textContent = `${roundText}${remaining} carte${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}`;
    } else {
      el.textContent = `${roundText}Dernière carte !`;
    }
  } else if (state.showFavouritesOnly) {
    const position = state.deck.indexOf(currentCard);
    const displayNumber = position >= 0 ? position + 1 : currentCard || '?';
    el.textContent = `Favori ${displayNumber} sur ${state.deck.length}`;
  } else {
    el.textContent = `Carte n°${currentCard}, ${state.deck.length} résultats`;
  }
}

// ==================== Bookmark ====================

export function updateBookmarkButton() {
  const btn = qs('#bookmarkBtn');
  if (!btn) return;
  const currentCard = getCurrentCard();
  btn.disabled = !currentCard;
  const favourites = loadFavourites();
  const isFavourite = favourites.has(currentCard);
  btn.classList.toggle('active', isFavourite);
  btn.setAttribute('aria-pressed', String(isFavourite));
  const textEl = btn.querySelector('.btn-text');
  if (textEl) {
    textEl.textContent = isFavourite ? 'Retirer' : 'Ajouter';
  }
  btn.setAttribute('aria-label', isFavourite ? 'Retirer des favoris' : 'Ajouter aux favoris');
}

export function updateFavouritesCount() {
  const count = loadFavourites().size;
  const countEl = qs('#favouritesCount');
  if (countEl) countEl.textContent = count.toString();
}

// ==================== Navigation Buttons ====================

export function updateNavButtons() {
  const prev = qs('#prevBtn');
  const next = qs('#nextBtn');
  const cannotBrowse = state.deck.length <= 1;

  if (cannotBrowse) {
    if (prev) prev.disabled = true;
  } else if (state.shuffle) {
    if (prev) prev.disabled = state.historyIndex <= 0;
  } else {
    if (prev) prev.disabled = false;
  }

  if (next) next.disabled = cannotBrowse;
}

// ==================== Mode/Filter UI ====================

export function updateRevisionUI() {
  const modeToggle = qs('#modeToggle');
  if (modeToggle) {
    modeToggle.classList.toggle('active', state.revisionMode);
    const textEl = modeToggle.querySelector('.toggle-text');
    if (textEl) {
      textEl.textContent = state.revisionMode ? 'Lecture' : 'Révision';
    }
  }

  const prevBtn = qs('#prevBtn');
  const nextBtn = qs('#nextBtn');
  const bookmarkBtn = qs('#bookmarkBtn');
  const pasOkBtn = qs('#pasOkBtn');
  const okBtn = qs('#okBtn');

  if (state.revisionMode) {
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    if (bookmarkBtn) bookmarkBtn.style.display = 'none';
    if (pasOkBtn) pasOkBtn.style.display = '';
    if (okBtn) okBtn.style.display = '';
  } else {
    if (prevBtn) prevBtn.style.display = '';
    if (nextBtn) nextBtn.style.display = '';
    if (bookmarkBtn) bookmarkBtn.style.display = '';
    if (pasOkBtn) pasOkBtn.style.display = 'none';
    if (okBtn) okBtn.style.display = 'none';
  }

  const randomToggle = qs('#randomToggle');
  const favToggle = qs('#favouritesToggle');
  const timerGroup = qs('#timerFilter')?.closest('.filter-group');
  const diffGroup = qs('#difficultyFilter')?.closest('.filter-group');

  if (state.revisionMode) {
    if (randomToggle) randomToggle.style.display = 'none';
    if (favToggle) favToggle.style.display = 'none';
    if (timerGroup) timerGroup.style.display = 'none';
    if (diffGroup) diffGroup.style.display = 'none';
  } else {
    if (randomToggle) randomToggle.style.display = '';
    if (favToggle) favToggle.style.display = '';
    if (timerGroup) timerGroup.style.display = '';
    if (diffGroup) diffGroup.style.display = '';
  }

  const restartBtn = qs('#restartRevisionInlineBtn');
  if (restartBtn) {
    restartBtn.style.display = state.revisionMode ? '' : 'none';
  }
}

export function updateShuffleUI() {
  const toggle = qs('#randomToggle');
  if (!toggle) return;
  const disabled = state.showFavouritesOnly || state.revisionMode;
  toggle.classList.toggle('active', state.shuffle);
  toggle.classList.toggle('disabled', disabled);
  toggle.setAttribute('aria-checked', String(state.shuffle));
  toggle.setAttribute('aria-disabled', String(disabled));
  toggle.setAttribute('tabindex', disabled ? '-1' : '0');
}

export function updateFavouritesUI() {
  const toggle = qs('#favouritesToggle');
  if (!toggle) return;
  const disabled = state.revisionMode;
  toggle.classList.toggle('active', state.showFavouritesOnly);
  toggle.classList.toggle('disabled', disabled);
  toggle.setAttribute('aria-checked', String(state.showFavouritesOnly));
  toggle.setAttribute('aria-disabled', String(disabled));
  toggle.setAttribute('tabindex', disabled ? '-1' : '0');
}

export function updateTimerUI() {
  const pills = qs('#timerFilter');
  if (pills) {
    pills.setAttribute('data-level', state.filterTimer);
  }
}

export function updateDifficultyUI() {
  const pills = qs('#difficultyFilter');
  if (pills) {
    pills.setAttribute('data-level', state.filterDifficulty);
  }
}

// ==================== Filter Cycling ====================

export function cycleTimer() {
  if (state.revisionMode || state.isTransitioning) return;

  const currentIndex = TIMER_STATES.indexOf(state.filterTimer);
  const nextIndex = (currentIndex + 1) % TIMER_STATES.length;
  state.filterTimer = TIMER_STATES[nextIndex];
  trackUmamiEvent(UMAMI_EVENTS.filterGroup, {
    group: 'timer',
    level: state.filterTimer,
  });
  updateTimerUI();

  const keep = getCurrentCard();
  rebuildDeck(keep);
  if (!state.deck.length) {
    showEmptyState();
    return;
  }
  showCurrent();
}

export function cycleDifficulty() {
  if (state.revisionMode || state.isTransitioning) return;

  const currentIndex = DIFFICULTY_STATES.indexOf(state.filterDifficulty);
  const nextIndex = (currentIndex + 1) % DIFFICULTY_STATES.length;
  state.filterDifficulty = DIFFICULTY_STATES[nextIndex];
  trackUmamiEvent(UMAMI_EVENTS.filterGroup, {
    group: 'difficulty',
    level: state.filterDifficulty,
  });
  updateDifficultyUI();

  const keep = getCurrentCard();
  rebuildDeck(keep);
  if (!state.deck.length) {
    showEmptyState();
    return;
  }
  showCurrent();
}
