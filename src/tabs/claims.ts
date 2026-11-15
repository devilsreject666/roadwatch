/**
 * Claims tab (visual shell for the photo's Claims screen).
 * There is no claim data model or filing workflow yet — that is a later
 * phase (AI damage assistant + claim generation). This tab is honest
 * about that: it shows an empty state, never invented claims or amounts.
 */
import type { TabContext } from '../context';
import { el } from '../ui';

export function createClaimsTab(root: HTMLElement, ctx: TabContext): () => void {
  root.className = 'tab-page tab-trips';

  function render(): void {
    root.innerHTML = '';
    root.appendChild(el('div', 'page-head', 'Claims'));

    const row = el('div', 'filter-row');
    for (const [label, active] of [['Active', true], ['Submitted', false], ['Resolved', false]] as const) {
      const chip = el('button', `filter-chip${active ? ' active' : ''}`, label);
      chip.addEventListener('click', () => {
        row.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
      });
      row.appendChild(chip);
    }
    root.appendChild(row);

    const card = el('div', 'card glass');
    card.appendChild(el('h3', '', 'No claims yet'));
    card.appendChild(
      el(
        'p',
        'muted',
        'Claims open once the damage assistant and claim filing arrive in a later update. ' +
          'Your pothole reports are saved and visible under Map.',
      ),
    );
    const goMap = el('button', 'btn btn-primary btn-block', 'View my pothole reports');
    goMap.addEventListener('click', () => ctx.goTab('map'));
    card.appendChild(goMap);
    root.appendChild(card);
  }

  render();
  return () => render();
}
