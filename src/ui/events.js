/**
 * UI event bindings
 */

import { state, getCurrentCard } from '../state.js';
import { qs } from '../utils/helpers.js';
import { UMAMI_EVENTS, trackUmamiEvent } from '../utils/analytics.js';
import { toggleFavourite } from '../core/storage.js';
import { nextCard, prevCard, toggleShuffle, toggleFavouritesOnly } from '../features/navigation.js';
import {
  toggleRevisionMode,
  markCardOK,
  markCardPasOK,
  restartRevisionSession,
} from '../features/revision-mode.js';
import { swipeGesture } from '../features/swipe.js';
import {
  setFlipped,
  cycleTimer,
  cycleDifficulty,
  updateBookmarkButton,
  updateFavouritesCount,
} from './updates.js';

const ACTIVATION_KEYS = new Set(['Enter', ' ']);
const FORM_CONTROLS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

function currentMode() {
  return state.revisionMode ? 'revision' : 'lecture';
}

function bindClick(selector, handler) {
  qs(selector)?.addEventListener('click', handler);
}

function bindPressable(element, activate) {
  if (!element) return;
  element.addEventListener('click', activate);
  element.addEventListener('keydown', (event) => {
    if (!ACTIVATION_KEYS.has(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    activate();
  });
}

function bindTrackedToggle({ selector, eventName, readValue, toggle, disabled = () => false }) {
  const element = qs(selector);
  bindPressable(element, () => {
    if (disabled() || element.classList.contains('disabled')) return;
    const previousValue = readValue();
    toggle();
    const enabled = readValue();
    if (enabled !== previousValue) {
      trackUmamiEvent(eventName, { enabled, mode: currentMode() });
    }
  });
}

function bindFilter(selector, cycle) {
  const filter = qs(selector);
  if (!filter) return;

  bindPressable(filter, cycle);
  filter.closest('.filter-group')?.addEventListener('click', (event) => {
    if (!filter.contains(event.target)) cycle();
  });
}

function toggleCurrentFavourite() {
  const currentCard = getCurrentCard();
  if (!currentCard) return;
  toggleFavourite(currentCard);
  updateBookmarkButton();
  updateFavouritesCount();
}

function flipCurrentCard() {
  if (!state.isTransitioning) setFlipped(!state.flipped);
}

function handleKeyboardShortcut(event) {
  if (event.target && FORM_CONTROLS.has(event.target.tagName)) return;

  if (event.key === ' ') {
    event.preventDefault();
    flipCurrentCard();
    return;
  }

  if (event.key === 'ArrowRight') {
    state.revisionMode ? markCardOK() : nextCard();
    return;
  }
  if (event.key === 'ArrowLeft') {
    state.revisionMode ? markCardPasOK() : prevCard();
    return;
  }
  if (state.revisionMode || event.ctrlKey || event.metaKey) return;

  const key = event.key.toLowerCase();
  if (key === 'r' && !state.showFavouritesOnly) toggleShuffle();
  else if (key === 'f') toggleFavouritesOnly();
  else if (key === 'b') toggleCurrentFavourite();
}

/**
 * Bind all UI event listeners.
 */
export function bindUI() {
  const siteLogo = qs('.site-logo');
  if (siteLogo) {
    siteLogo.href = window.location.href;
    siteLogo.addEventListener('click', () => {
      localStorage.setItem('fc_revision_mode', 'false');
    });
  }

  bindClick('#cardShell', () => {
    if (!swipeGesture.hasMovedHorizontally) flipCurrentCard();
  });
  bindClick('#bookmarkBtn', toggleCurrentFavourite);
  bindClick('#prevBtn', prevCard);
  bindClick('#nextBtn', () => {
    trackUmamiEvent(UMAMI_EVENTS.nextButton, { mode: currentMode() });
    nextCard();
  });
  bindClick('#pasOkBtn', markCardPasOK);
  bindClick('#okBtn', markCardOK);
  bindClick('#modeToggle', () => {
    toggleRevisionMode();
    trackUmamiEvent(UMAMI_EVENTS.modeToggle, { mode: currentMode() });
  });
  bindClick('#restartRevisionInlineBtn', () => {
    if (confirm('Recommencer la révision depuis le début ?')) restartRevisionSession();
  });

  bindTrackedToggle({
    selector: '#randomToggle',
    eventName: UMAMI_EVENTS.randomToggle,
    readValue: () => state.shuffle,
    toggle: toggleShuffle,
    disabled: () => state.showFavouritesOnly || state.revisionMode,
  });
  bindTrackedToggle({
    selector: '#favouritesToggle',
    eventName: UMAMI_EVENTS.favouritesToggle,
    readValue: () => state.showFavouritesOnly,
    toggle: toggleFavouritesOnly,
    disabled: () => state.revisionMode,
  });
  bindFilter('#timerFilter', cycleTimer);
  bindFilter('#difficultyFilter', cycleDifficulty);
  window.addEventListener('keydown', handleKeyboardShortcut);
}

// ==================== Info Tooltip ====================

export function initInfoTooltip() {
  const infoBtn = document.getElementById('infoBtn');
  const helpTooltip = document.getElementById('helpTooltip');

  if (infoBtn && helpTooltip) {
    let tooltipVisible = false;
    let repositionFrame = null;

    const resetTooltipStyles = () => {
      helpTooltip.style.position = '';
      helpTooltip.style.top = '';
      helpTooltip.style.left = '';
      helpTooltip.style.right = '';
      helpTooltip.style.bottom = '';
      helpTooltip.style.removeProperty('--tooltip-offset-x');
      helpTooltip.dataset.placement = 'bottom';
    };

    const closeTooltip = () => {
      if (!tooltipVisible) return;
      tooltipVisible = false;
      helpTooltip.classList.add('hidden');
      helpTooltip.setAttribute('aria-hidden', 'true');
      infoBtn.setAttribute('aria-expanded', 'false');
      if (repositionFrame !== null) {
        cancelAnimationFrame(repositionFrame);
        repositionFrame = null;
      }
      resetTooltipStyles();
    };

    const positionTooltip = () => {
      if (!tooltipVisible) return;

      const spacing = 12;
      const buttonRect = infoBtn.getBoundingClientRect();

      helpTooltip.style.position = 'fixed';
      helpTooltip.style.right = 'auto';
      helpTooltip.style.bottom = 'auto';
      helpTooltip.dataset.placement = 'bottom';

      const anchorX = buttonRect.left + buttonRect.width / 2;
      helpTooltip.style.left = `${anchorX}px`;
      helpTooltip.style.setProperty('--tooltip-offset-x', '0px');

      const tooltipRect = helpTooltip.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const halfWidth = tooltipRect.width / 2;

      const leftBoundary = anchorX - halfWidth;
      const rightBoundary = anchorX + halfWidth;
      const overflowLeft = Math.max(spacing - leftBoundary, 0);
      const overflowRight = Math.max(rightBoundary - (viewportWidth - spacing), 0);
      const offsetX = overflowLeft - overflowRight;
      helpTooltip.style.setProperty('--tooltip-offset-x', `${offsetX}px`);

      let top = buttonRect.bottom + spacing;
      let placement = 'bottom';

      if (top + tooltipRect.height > viewportHeight - spacing) {
        const aboveTop = buttonRect.top - spacing - tooltipRect.height;
        if (aboveTop >= spacing) {
          top = aboveTop;
          placement = 'top';
        } else {
          top = Math.max(spacing, viewportHeight - tooltipRect.height - spacing);
        }
      }

      const minTop = spacing;
      const maxTop = Math.max(spacing, viewportHeight - tooltipRect.height - spacing);
      top = Math.min(Math.max(top, minTop), maxTop);

      helpTooltip.style.top = `${top}px`;
      helpTooltip.dataset.placement = placement;
    };

    const scheduleTooltipReposition = () => {
      if (!tooltipVisible) return;
      if (repositionFrame !== null) return;
      repositionFrame = requestAnimationFrame(() => {
        repositionFrame = null;
        positionTooltip();
      });
    };

    const openTooltip = () => {
      if (tooltipVisible) return;
      tooltipVisible = true;
      helpTooltip.classList.remove('hidden');
      helpTooltip.setAttribute('aria-hidden', 'false');
      infoBtn.setAttribute('aria-expanded', 'true');
      scheduleTooltipReposition();
    };

    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (tooltipVisible) {
        closeTooltip();
      } else {
        openTooltip();
      }
    });

    document.addEventListener('click', (e) => {
      if (!infoBtn.contains(e.target) && !helpTooltip.contains(e.target)) {
        closeTooltip();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && tooltipVisible) {
        closeTooltip();
        infoBtn.focus();
      }
    });

    const handleViewportChange = () => {
      if (!tooltipVisible) return;
      scheduleTooltipReposition();
    };

    window.addEventListener('resize', handleViewportChange, { passive: true });
    window.addEventListener('scroll', handleViewportChange, { passive: true });
  }
}

// ==================== Touch Detection ====================

export function initTouchDetection() {
  try {
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouch) return;

    document.documentElement.classList.add('is-touch');

    if (document.documentElement.dataset.touchCleanupBound === 'true') return;
    document.documentElement.dataset.touchCleanupBound = 'true';

    const clearTouchFocusedControl = () => {
      const activeElement = document.activeElement;
      if (!(activeElement instanceof HTMLElement)) return;
      if (!activeElement.matches('button, [role="button"], [role="switch"], a[href]')) return;
      activeElement.blur();
    };

    document.addEventListener(
      'pointerup',
      (event) => {
        if (event.pointerType !== 'touch') return;
        requestAnimationFrame(clearTouchFocusedControl);
      },
      true
    );

    document.addEventListener(
      'touchend',
      () => {
        requestAnimationFrame(clearTouchFocusedControl);
      },
      { passive: true, capture: true }
    );
  } catch {
    // Ignore touch detection errors
  }
}
