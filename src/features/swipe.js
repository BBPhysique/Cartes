/**
 * Mobile swipe gesture handler
 */

import { state } from '../state.js';
import { qs } from '../utils/helpers.js';
import { gradeRevisionCard } from './revision-mode.js';
import { resetSwipeTransform } from '../ui/card-motion.js';

export const swipeGesture = {
  // Configuration
  THRESHOLD_RATIO: 0.25,
  VELOCITY_THRESHOLD: 0.3,
  MAX_ROTATION: 15,
  VERTICAL_FACTOR: 0.1,
  VELOCITY_SAMPLES: 5,

  // State
  isActive: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  deltaX: 0,
  deltaY: 0,
  velocityHistory: [],
  cardShell: null,
  zoneOk: null,
  zoneReview: null,
  isTouchDevice: false,
  hasMovedHorizontally: false,
  rafId: null,

  init() {
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    if (!this.isTouchDevice) return;

    this.cardShell = qs('#cardShell');
    this.zoneOk = qs('.swipe-zone-ok');
    this.zoneReview = qs('.swipe-zone-review');

    if (!this.cardShell) return;

    this.cardShell.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: true });
    this.cardShell.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
    this.cardShell.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: true });
    this.cardShell.addEventListener('touchcancel', this.onTouchCancel.bind(this), {
      passive: true,
    });
  },

  getThreshold() {
    return window.innerWidth * this.THRESHOLD_RATIO;
  },

  onTouchStart(e) {
    if (!state.revisionMode) return;
    if (state.isTransitioning) return;
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.currentX = touch.clientX;
    this.currentY = touch.clientY;
    this.deltaX = 0;
    this.deltaY = 0;
    this.velocityHistory = [];
    this.hasMovedHorizontally = false;
    this.isActive = true;

    this.cardShell.classList.add('swiping');
    document.body.classList.add('revision-active');

    this.startRaf();
  },

  startRaf() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    const loop = () => {
      if (!this.isActive) return;
      this.updateCardTransform();
      this.updateZones();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  },

  stopRaf() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  },

  onTouchMove(e) {
    if (!this.isActive) return;
    if (!state.revisionMode) {
      this.reset();
      return;
    }
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    const newDeltaX = touch.clientX - this.startX;
    const newDeltaY = touch.clientY - this.startY;

    if (!this.hasMovedHorizontally) {
      const absX = Math.abs(newDeltaX);
      const absY = Math.abs(newDeltaY);

      if (absY > absX && absY > 10) {
        this.reset();
        return;
      }

      if (absX > absY && absX > 10) {
        this.hasMovedHorizontally = true;
      }
    }

    if (this.hasMovedHorizontally) {
      e.preventDefault();
    }

    this.currentX = touch.clientX;
    this.currentY = touch.clientY;
    this.deltaX = newDeltaX;
    this.deltaY = newDeltaY;

    const now = Date.now();
    this.velocityHistory.push({ x: this.deltaX, y: this.deltaY, time: now });
    if (this.velocityHistory.length > this.VELOCITY_SAMPLES) {
      this.velocityHistory.shift();
    }
  },

  onTouchEnd() {
    this.stopRaf();
    if (!this.isActive) return;

    const velocity = this.calculateVelocity();
    const threshold = this.getThreshold();
    const absVelocity = Math.abs(velocity);

    let action = null;

    if (absVelocity > this.VELOCITY_THRESHOLD) {
      action = velocity > 0 ? 'ok' : 'review';
    } else if (Math.abs(this.deltaX) > threshold) {
      action = this.deltaX > 0 ? 'ok' : 'review';
    }

    if (action) {
      this.completeSwipe(action);
    } else {
      this.snapBack();
    }
  },

  onTouchCancel() {
    this.stopRaf();
    this.snapBack();
  },

  calculateVelocity() {
    if (this.velocityHistory.length < 2) return 0;

    const recent = this.velocityHistory.slice(-3);
    if (recent.length < 2) return 0;

    const first = recent[0];
    const last = recent[recent.length - 1];
    const timeDiff = last.time - first.time;

    if (timeDiff === 0) return 0;

    return (last.x - first.x) / timeDiff;
  },

  updateCardTransform() {
    if (!this.cardShell) return;

    const threshold = this.getThreshold();
    const rotation = (this.deltaX / threshold) * this.MAX_ROTATION;
    const clampedRotation = Math.max(-this.MAX_ROTATION, Math.min(this.MAX_ROTATION, rotation));
    const verticalOffset = this.deltaY * this.VERTICAL_FACTOR;

    this.cardShell.style.transform = `translate3d(${this.deltaX}px, ${verticalOffset}px, 0) rotate(${clampedRotation}deg)`;
  },

  updateZones() {
    if (!this.zoneOk || !this.zoneReview) return;

    const threshold = this.getThreshold();
    const progress = Math.abs(this.deltaX) / threshold;
    const shouldShowZone = progress >= 1.0;

    if (this.deltaX > 0) {
      if (shouldShowZone) {
        this.zoneOk.classList.add('active');
      } else {
        this.zoneOk.classList.remove('active');
      }
      this.zoneReview.classList.remove('active');
    } else if (this.deltaX < 0) {
      if (shouldShowZone) {
        this.zoneReview.classList.add('active');
      } else {
        this.zoneReview.classList.remove('active');
      }
      this.zoneOk.classList.remove('active');
    } else {
      this.zoneOk.classList.remove('active');
      this.zoneReview.classList.remove('active');
    }
  },

  completeSwipe(action) {
    if (!this.cardShell) {
      this.reset();
      return;
    }

    const currentDeltaX = this.deltaX;
    const currentDeltaY = this.deltaY * this.VERTICAL_FACTOR;
    const threshold = this.getThreshold();
    const currentRotation = (this.deltaX / threshold) * this.MAX_ROTATION;
    const clampedRotation = Math.max(
      -this.MAX_ROTATION,
      Math.min(this.MAX_ROTATION, currentRotation)
    );

    this.cardShell.classList.remove('swiping');

    if (this.zoneOk) this.zoneOk.classList.remove('active');
    if (this.zoneReview) this.zoneReview.classList.remove('active');

    this.cardShell.style.setProperty('--swipe-start-x', `${currentDeltaX}px`);
    this.cardShell.style.setProperty('--swipe-start-y', `${currentDeltaY}px`);
    this.cardShell.style.setProperty('--swipe-start-rotation', `${clampedRotation}deg`);

    this.cardShell.style.transform = '';

    void this.cardShell.offsetWidth;

    const exitClass = action === 'ok' ? 'swipe-exit-right' : 'swipe-exit-left';
    this.cardShell.classList.add('swipe-exit', exitClass);

    this.isActive = false;
    document.body.classList.remove('revision-active');

    this.handleSwipeTransition(action);
  },

  async handleSwipeTransition(action) {
    const transitioned = await gradeRevisionCard(action, { gestureStarted: true });
    if (!transitioned) this.resetCardTransform();
  },

  snapBack() {
    if (!this.cardShell) {
      this.reset();
      return;
    }

    if (this.zoneOk) this.zoneOk.classList.remove('active');
    if (this.zoneReview) this.zoneReview.classList.remove('active');

    this.cardShell.classList.remove('swiping');
    this.cardShell.classList.add('snap-back');

    this.cardShell.style.transform = '';

    setTimeout(() => {
      if (this.cardShell) {
        this.cardShell.classList.remove('snap-back');
      }
      this.reset();
    }, 300);
  },

  reset() {
    this.stopRaf();
    this.isActive = false;
    this.deltaX = 0;
    this.deltaY = 0;
    this.velocityHistory = [];
    this.hasMovedHorizontally = false;
    document.body.classList.remove('revision-active');

    if (this.cardShell) {
      this.cardShell.classList.remove('swiping');
    }
    if (this.zoneOk) this.zoneOk.classList.remove('active');
    if (this.zoneReview) this.zoneReview.classList.remove('active');
  },

  resetCardTransform() {
    resetSwipeTransform(this.cardShell, this.zoneOk, this.zoneReview);
  },
};
