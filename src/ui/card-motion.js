import { qs } from '../utils/helpers.js';

export function resetSwipeTransform(
  cardShell = qs('#cardShell'),
  zoneOk = qs('.swipe-zone-ok'),
  zoneReview = qs('.swipe-zone-review')
) {
  if (cardShell) {
    cardShell.style.transform = '';
    cardShell.classList.remove(
      'swiping',
      'snap-back',
      'swipe-exit',
      'swipe-exit-left',
      'swipe-exit-right'
    );
    cardShell.style.removeProperty('--swipe-start-x');
    cardShell.style.removeProperty('--swipe-start-y');
    cardShell.style.removeProperty('--swipe-start-rotation');
  }
  if (zoneOk) zoneOk.classList.remove('active');
  if (zoneReview) zoneReview.classList.remove('active');
}
