/**
 * Shared tab context: repository, providers, theme, and cross-tab refresh.
 */
import { NominatimGeocoder, OsrmRouter } from './providers';
import type { GeocodingProvider, RoutingProvider } from './providers';
import { LocalStorageRepository } from './store';
import type { Repository } from './store';
import { autoDetect } from './autoDetect';
import { locationService } from './location';
import type { Theme } from './mapView';

export type TabName = 'navigate' | 'map' | 'trips' | 'profile';

export interface TabContext {
  repo: Repository;
  geocoder: GeocodingProvider;
  router: RoutingProvider;
  goTab: (t: TabName) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onThemeChange: (fn: (t: Theme) => void) => void;
  registerPotholeLayer: (refresh: () => void) => void;
  refreshPotholeLayers: () => void;
}

export function createContext(goTab: (t: TabName) => void): TabContext {
  const repo = new LocalStorageRepository();
  locationService.setTrackingEnabled(repo.getPrivacy().locationTracking);

  let theme: Theme = 'dark';
  const themeListeners = new Set<(t: Theme) => void>();
  const layerRefreshers = new Set<() => void>();

  autoDetect.init(repo, () => {
    for (const fn of layerRefreshers) fn();
  });

  return {
    repo,
    geocoder: new NominatimGeocoder(),
    router: new OsrmRouter(),
    goTab,
    get theme() {
      return theme;
    },
    setTheme(t) {
      theme = t;
      for (const fn of themeListeners) fn(t);
    },
    onThemeChange(fn) {
      themeListeners.add(fn);
    },
    registerPotholeLayer(fn) {
      layerRefreshers.add(fn);
    },
    refreshPotholeLayers() {
      for (const fn of layerRefreshers) fn();
    },
  };
}
