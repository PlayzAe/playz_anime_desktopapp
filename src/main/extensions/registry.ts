import { EXTENSION_CATALOG } from './catalog';
import { MadaraDriver } from './drivers/madara';
import { MangaBoxDriver } from './drivers/mangabox';
import { MangaStreamDriver } from './drivers/mangastream';
import type { MangaExtensionConfig, MangaExtensionSource } from './types';

class ExtensionRegistry {
  private sources = new Map<string, MangaExtensionSource>();
  private userEnabled = new Map<string, boolean>();

  constructor() {
    this.init();
  }

  private init() {
    for (const config of EXTENSION_CATALOG) {
      let driver: MangaExtensionSource | null = null;
      if (config.engine === 'madara') {
        driver = new MadaraDriver(config);
      } else if (config.engine === 'mangastream') {
        driver = new MangaStreamDriver(config);
      } else if (config.engine === 'mangabox') {
        driver = new MangaBoxDriver(config);
      }
      if (driver) {
        this.sources.set(config.id, driver);
      }
    }
  }

  getAllConfigs(): MangaExtensionConfig[] {
    return EXTENSION_CATALOG.map((c) => ({
      ...c,
      enabled: this.userEnabled.has(c.id) ? this.userEnabled.get(c.id)! : (c.enabled ?? true),
    }));
  }

  getSource(id: string): MangaExtensionSource | undefined {
    return this.sources.get(id);
  }

  toggle(id: string, enabled: boolean) {
    this.userEnabled.set(id, enabled);
  }

  isEnabled(id: string): boolean {
    if (this.userEnabled.has(id)) return this.userEnabled.get(id)!;
    const found = EXTENSION_CATALOG.find((c) => c.id === id);
    return found?.enabled ?? true;
  }
}

export const extensionRegistry = new ExtensionRegistry();
