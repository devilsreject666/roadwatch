/**
 * RoadWatch MVP — app shell: bottom tab bar + lazy tab pages.
 */
import { createContext } from './context';
import type { TabName } from './context';
import { createNavigateTab } from './tabs/navigate';
import { createMapTab } from './tabs/mapTab';
import { createTripsTab } from './tabs/trips';
import { createProfileTab } from './tabs/profile';
import { el } from './ui';
import './styles.css';

document.body.dataset.theme = 'dark';

const app = document.getElementById('app')!;
const pages = el('div', 'pages');
app.appendChild(pages);

const tabs: Array<{ name: TabName; label: string; icon: string }> = [
  { name: 'navigate', label: 'Navigate', icon: '🧭' },
  { name: 'map', label: 'Map', icon: '🗺️' },
  { name: 'trips', label: 'Trips', icon: '🚗' },
  { name: 'profile', label: 'Profile', icon: '👤' },
];

const pageEls = new Map<TabName, HTMLElement>();
const onShow = new Map<TabName, () => void>();
let active: TabName = 'navigate';

const ctx = createContext((t) => switchTab(t));

const builders: Record<TabName, (root: HTMLElement) => () => void> = {
  navigate: (r) => createNavigateTab(r, ctx),
  map: (r) => createMapTab(r, ctx),
  trips: (r) => createTripsTab(r, ctx),
  profile: (r) => createProfileTab(r, ctx),
};

function ensurePage(name: TabName): HTMLElement {
  let page = pageEls.get(name);
  if (!page) {
    page = el('div', 'page');
    page.dataset.tab = name;
    pages.appendChild(page);
    pageEls.set(name, page);
    onShow.set(name, builders[name](page));
  }
  return page;
}

function switchTab(name: TabName): void {
  active = name;
  for (const t of tabs) {
    const page = t.name === name ? ensurePage(name) : pageEls.get(t.name);
    if (page) page.classList.toggle('active', t.name === name);
  }
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', (b as HTMLElement).dataset.tab === name);
  });
  // Let the map in the newly visible tab measure its container.
  requestAnimationFrame(() => {
    onShow.get(name)?.();
  });
}

const tabBar = el('nav', 'tab-bar glass');
for (const t of tabs) {
  const btn = el('button', 'tab-btn', `${t.icon}\n${t.label}`);
  btn.dataset.tab = t.name;
  btn.setAttribute('aria-label', t.label);
  btn.addEventListener('click', () => switchTab(t.name));
  tabBar.appendChild(btn);
}
app.appendChild(tabBar);

switchTab('navigate');
