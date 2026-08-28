/**
 * Revision mode (spaced repetition)
 */

import { state, getCurrentCard, getCurrentRevisionDeck } from '../state.js';
import { MAX_HISTORY } from '../config.js';
import { qs, shuffleArray } from '../utils/helpers.js';
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
  exitCurrentCard,
} from '../ui/updates.js';

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
function resetShuffleForRevision(preferredCard = null) {
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
function startNewRevisionRound() {
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
function showRevisionComplete() {
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
 * Select the next unseen card in revision mode.
 * Rendering is handled by the shared card transition.
 * @returns {boolean}
 */
function nextRevisionCard() {
  if (!state.deck.length) return false;

  const unseenCards = state.deck.filter((card) => !state.revisionSeen.has(card));
  if (unseenCards.length === 0) return false;

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
  return true;
}

/**
 * Record a revision answer and run the shared card transition.
 * @param {'ok'|'review'} result
 * @param {{gestureStarted?: boolean}} options
 * @returns {Promise<boolean>}
 */
export async function gradeRevisionCard(result, options = {}) {
  if (state.isTransitioning) return false;
  const currentCard = getCurrentCard();
  if (!currentCard || (result !== 'ok' && result !== 'review')) return false;

  if (result === 'ok') {
    state.revisionIncorrect.delete(currentCard);
    state.revisionMastered.add(currentCard);
  } else {
    state.revisionIncorrect.add(currentCard);
    state.revisionMastered.delete(currentCard);
  }
  state.revisionSeen.add(currentCard);

  saveRevisionProgress();
  const revisionDirection = result === 'ok' ? 'right' : 'left';
  const transitionOptions = { gestureStarted: Boolean(options.gestureStarted) };

  if (checkRoundComplete()) {
    const transitioned = await exitCurrentCard(revisionDirection, transitionOptions);
    if (transitioned) handleRoundComplete();
    return transitioned;
  }

  if (!nextRevisionCard()) return false;
  return showCurrent('none', { revisionDirection, ...transitionOptions });
}

/**
 * Mark current card as OK (mastered)
 */
export function markCardOK() {
  return gradeRevisionCard('ok');
}

/**
 * Mark current card as not OK (needs review)
 */
export function markCardPasOK() {
  return gradeRevisionCard('review');
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
