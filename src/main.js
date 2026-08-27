/**
 * Cartes - Flashcard Application
 * Entry point
 */

import './styles.css';
import { state } from './state.js';
import { qs } from './utils/helpers.js';
import { discoverChapters, loadChapter } from './features/chapters.js';
import { getStoredChapter, storeSelectedChapter } from './core/storage.js';
import { swipeGesture } from './features/swipe.js';
import { bindUI, checkWelcomeModal, initInfoTooltip, initTouchDetection } from './ui/events.js';
import {
  showSkeleton,
  hideSkeleton,
  updateShuffleUI,
  updateFavouritesUI,
  updateRevisionUI,
  updateTimerUI,
  updateDifficultyUI,
} from './ui/updates.js';

const chapterSelectTextMeasurer = document.createElement('canvas').getContext('2d');

/**
 * Size the chapter selector to its current label while preserving room for its arrow.
 * @param {HTMLSelectElement} select
 */
function syncChapterSelectWidth(select) {
  const option = select.selectedOptions[0];
  if (!option || !chapterSelectTextMeasurer) return;

  const styles = getComputedStyle(select);
  chapterSelectTextMeasurer.font = [
    styles.fontStyle,
    styles.fontWeight,
    styles.fontSize,
    styles.fontFamily,
  ].join(' ');

  const textWidth = chapterSelectTextMeasurer.measureText(option.textContent).width;
  const horizontalChrome =
    parseFloat(styles.paddingLeft) +
    parseFloat(styles.paddingRight) +
    parseFloat(styles.borderLeftWidth) +
    parseFloat(styles.borderRightWidth);

  select.style.setProperty('--chapter-select-width', `${Math.ceil(textWidth + horizontalChrome)}px`);
}

/**
 * Build the chapter select dropdown
 * @param {number[]} chapters
 * @returns {number}
 */
function buildChapterSelect(chapters) {
  const sel = qs('#chapterSelect');
  sel.innerHTML = '';
  chapters.forEach((n) => {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = `Chapitre ${n}`;
    sel.appendChild(opt);
  });
  const storedChapter = getStoredChapter(chapters);
  const initial = storedChapter ?? (chapters.includes(1) ? 1 : chapters[0]);
  sel.value = String(initial);
  syncChapterSelectWidth(sel);
  sel.addEventListener('change', async (e) => {
    syncChapterSelectWidth(e.currentTarget);
    const val = parseInt(e.target.value, 10);
    await loadChapter(val);
    storeSelectedChapter(val);
  });

  document.fonts?.ready.then(() => syncChapterSelectWidth(sel));
  return initial;
}

/**
 * Initialize the application
 */
async function init() {
  // Early touch detection
  initTouchDetection();

  // Restore body class for revision mode if needed
  if (state.revisionMode) {
    document.body.classList.add('mode-revision');
  }

  // Set up event listeners
  bindUI();
  initInfoTooltip();
  swipeGesture.init();

  // Initialize UI state
  updateShuffleUI();
  updateFavouritesUI();
  updateRevisionUI();
  updateTimerUI();
  updateDifficultyUI();

  // Load chapters
  showSkeleton();
  const chapters = await discoverChapters();

  if (!chapters.length) {
    hideSkeleton();
    qs('#counter').textContent = "Aucun chapitre trouvé (dossier 'flashcards/chN_cartes').";
    return;
  }

  const initial = buildChapterSelect(chapters);
  await loadChapter(initial);
  storeSelectedChapter(initial);

  // Check and show welcome modal if needed
  checkWelcomeModal();
}

// Start the application
init();
