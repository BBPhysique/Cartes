/**
 * Revision mode (spaced repetition)
 */

import { state, getCurrentCard, getCurrentRevisionDeck } from '../state.js';
import { MAX_HISTORY } from '../config.js';
import { qs } from '../utils/helpers.js';
import { shuffleArray } from '../utils/helpers.js';
import {
  saveRevisionProgress,
  loadRevisionProgress,
  clearRevisionProgress,
  saveHistory,
} from '../core/storage.js';
import { rebuildDeck, resetFastNavState } from './navigation.js';
import {
  showCurrent,
  updateRevisionUI,
  updateShuffleUI,
  updateFavouritesUI,
  updateCounter,
  setModalVisibility,
} from '../ui/updates.js';
import { resetSwipeTransform } from '../ui/card-motion.js';

/**
 * Reset revision progress to initial state
 */
export function resetRevisionProgress() {
  state.revisionRound = 1;
  state.revisionIncorrect = new Set();
  state.revisionSeen = new Set();
  state.revisionMastered = new Set();
  clearRevisionProgress();
}

/**
 * Reset shuffle state for revision mode
 * @param {number|null} preferredCard
 */
export function resetShuffleForRevision(preferredCard = null) {
  const currentDeck = getCurrentRevisionDeck();
  state.unvisited = new Set(currentDeck);
  state.history = [];
  state.historyIndex = -1;

  if (!currentDeck.length) {
    state.shuffleQueue = [];
    return;
  }

  let firstCard = preferredCard;
  if (firstCard === null || firstCard === undefined || !state.unvisited.has(firstCard)) {
    const randomIdx = Math.floor(Math.random() * currentDeck.length);
    firstCard = currentDeck[randomIdx];
  }

  state.history = [firstCard];
  state.historyIndex = 0;
  state.unvisited.delete(firstCard);

  state.shuffleQueue = shuffleArray(Array.from(state.unvisited));
  saveHistory();
}

/**
 * Check if the current round is complete
 * @returns {boolean}
 */
export function checkRoundComplete() {
  const currentDeck = getCurrentRevisionDeck();
  return state.revisionSeen.size >= currentDeck.length;
}

/**
 * Start a new revision round with incorrect cards
 */
export function startNewRevisionRound() {
  state.revisionRound++;
  state.revisionSeen = new Set();

  if (state.revisionIncorrect.size > 0) {
    state.deck = Array.from(state.revisionIncorrect);
  }

  saveRevisionProgress();
  resetShuffleForRevision();

  showCurrent();
  updateRevisionUI();
  updateCounter();
}

/**
 * Handle round completion
 */
export function handleRoundComplete() {
  if (state.revisionIncorrect.size === 0) {
    showRevisionComplete();
  } else {
    startNewRevisionRound();
  }
}

function removeRevisionCompleteModal(modal) {
  setModalVisibility(modal, false);

  const remove = () => modal.remove();
  const onTransitionEnd = (event) => {
    if (event.target === modal && event.propertyName === 'opacity') {
      remove();
    }
  };

  modal.addEventListener('transitionend', onTransitionEnd);
  window.setTimeout(remove, 300);
}

function createRevisionCompleteModal() {
  const modal = document.createElement('div');
  modal.id = 'revisionCompleteModal';
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'revisionCompleteTitle');
  modal.innerHTML = `
    <div class="modal-content modal-complete">
      <div class="complete-checkmark" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round">
          <path d="m6 12 4 4 8-8" />
        </svg>
      </div>
      <h2 id="revisionCompleteTitle">Chapitre maîtrisé</h2>
      <p class="complete-stats"></p>
      <div class="modal-actions">
        <button type="button" class="modal-btn modal-btn-primary">Recommencer</button>
        <button type="button" class="modal-btn modal-btn-ghost">Mode lecture</button>
      </div>
    </div>
  `;

  const restartButton = modal.querySelector('.modal-btn-primary');
  const lectureButton = modal.querySelector('.modal-btn-ghost');

  restartButton.addEventListener('click', () => {
    restartRevisionSession();
    removeRevisionCompleteModal(modal);
  });
  lectureButton.addEventListener('click', () => {
    removeRevisionCompleteModal(modal);
    toggleRevisionMode();
  });

  document.body.appendChild(modal);
  return modal;
}

/**
 * Show the revision complete modal
 */
export function showRevisionComplete() {
  if (!state.revisionMode || state.revisionIncorrect.size > 0 || !checkRoundComplete()) return;

  const modal = qs('#revisionCompleteModal') ?? createRevisionCompleteModal();
  const stats = modal.querySelector('.complete-stats');
  const plural = state.revisionRound > 1 ? 's' : '';
  stats.textContent = `${state.revisionRound} tour${plural} complété${plural}`;

  // Ensure the initial hidden style is painted before starting the entrance transition.
  void modal.offsetWidth;
  setModalVisibility(modal, true);
  modal.querySelector('.modal-btn-primary').focus();
}

/**
 * Navigate to the next unseen card in revision mode
 */
export function nextRevisionCard() {
  if (!state.deck.length) return;

  const unseenCards = state.deck.filter((card) => !state.revisionSeen.has(card));

  if (unseenCards.length === 0) {
    handleRoundComplete();
    return;
  }

  const randomIndex = Math.floor(Math.random() * unseenCards.length);
  const nextCardNo = unseenCards[randomIndex];

  state.history.push(nextCardNo);
  if (state.history.length > MAX_HISTORY) {
    state.history.shift();
    state.historyIndex = MAX_HISTORY - 1;
  } else {
    state.historyIndex++;
  }

  state.unvisited.delete(nextCardNo);
  saveHistory();

  showCurrentWithScaleIn();
  updateCounter();
}

/**
 * Show current card with scale-in animation
 */
export async function showCurrentWithScaleIn() {
  const cardShell = qs('#cardShell');
  if (!cardShell) {
    showCurrent();
    return;
  }

  resetSwipeTransform(cardShell);

  cardShell.style.transition = 'none';
  cardShell.style.transform = '';
  cardShell.style.opacity = '0';
  cardShell.style.visibility = 'hidden';

  void cardShell.offsetWidth;

  await showCurrent('none', { keepHidden: true });

  cardShell.classList.add('scaling-in');
  cardShell.style.visibility = '';
  cardShell.style.opacity = '';

  setTimeout(() => {
    cardShell.classList.remove('scaling-in');
    cardShell.style.transition = '';
  }, 300);
}

/**
 * Swipe the current card away with animation
 * @param {string} direction
 * @param {Function} callback
 */
export async function swipeCard(direction, callback) {
  const cardShell = qs('#cardShell');
  if (!cardShell) return;

  state.isTransitioning = true;

  resetSwipeTransform(cardShell);
  cardShell.style.transform = '';

  void cardShell.offsetWidth;

  const animationClass = direction === 'right' ? 'swiping-right' : 'swiping-left';
  cardShell.classList.add(animationClass);

  setTimeout(() => {
    cardShell.style.transition = 'none';
    cardShell.style.opacity = '0';
    cardShell.style.visibility = 'hidden';

    void cardShell.offsetWidth;

    cardShell.classList.remove(animationClass);
    cardShell.style.transform = '';
    state.isTransitioning = false;

    if (callback) callback();
  }, 300);
}

/**
 * Mark current card as OK (mastered)
 */
export function markCardOK() {
  if (state.isTransitioning) return;
  const currentCard = getCurrentCard();
  if (!currentCard) return;

  state.revisionIncorrect.delete(currentCard);
  state.revisionMastered.add(currentCard);
  state.revisionSeen.add(currentCard);

  saveRevisionProgress();

  if (checkRoundComplete()) {
    swipeCard('right', () => handleRoundComplete());
  } else {
    swipeCard('right', () => nextRevisionCard());
  }
}

/**
 * Mark current card as not OK (needs review)
 */
export function markCardPasOK() {
  if (state.isTransitioning) return;
  const currentCard = getCurrentCard();
  if (!currentCard) return;

  state.revisionIncorrect.add(currentCard);
  state.revisionSeen.add(currentCard);
  state.revisionMastered.delete(currentCard);

  saveRevisionProgress();

  if (checkRoundComplete()) {
    swipeCard('left', () => handleRoundComplete());
  } else {
    swipeCard('left', () => nextRevisionCard());
  }
}

/**
 * Restart the revision session
 */
export function restartRevisionSession() {
  if (!state.revisionMode) return;

  resetRevisionProgress();
  rebuildDeck();

  if (!state.deck.length) {
    updateCounter();
    return;
  }

  if (!state.shuffle) {
    state.shuffle = true;
    localStorage.setItem('fc_shuffle', 'true');
  }

  resetShuffleForRevision();
  showCurrent();
  updateRevisionUI();
  updateCounter();
}

/**
 * Toggle revision mode on/off
 */
export function toggleRevisionMode() {
  if (state.isTransitioning) return;
  const previousCard = getCurrentCard();
  state.revisionMode = !state.revisionMode;
  localStorage.setItem('fc_revision_mode', JSON.stringify(state.revisionMode));
  resetFastNavState();

  document.body.classList.toggle('mode-revision', state.revisionMode);

  if (state.revisionMode) {
    const progress = loadRevisionProgress();
    if (progress) {
      state.revisionRound = progress.round;
      state.revisionIncorrect = progress.incorrect;
      state.revisionSeen = progress.seen;
      state.revisionMastered = progress.mastered;

      if (state.revisionRound > 1 && state.revisionIncorrect.size > 0) {
        state.deck = Array.from(state.revisionIncorrect);
      }
    } else {
      resetRevisionProgress();
    }

    if (!state.shuffle) {
      state.shuffle = true;
      localStorage.setItem('fc_shuffle', 'true');
    }
    resetShuffleForRevision(previousCard);

    if (state.showFavouritesOnly) {
      state.showFavouritesOnly = false;
    }
  } else {
    const keep = getCurrentCard();
    rebuildDeck(keep);
  }

  updateRevisionUI();
  updateShuffleUI();
  updateFavouritesUI();
  updateCounter();
  showCurrent();
}
