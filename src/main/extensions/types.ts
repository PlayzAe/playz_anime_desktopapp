import type { Chapter, ChapterPage, MediaDetail } from '../../src/shared/types';

export type ExtensionEngine = 'madara' | 'mangastream' | 'mangabox' | 'custom';
export type ExtensionCategory = 'manhwa' | 'manga' | 'manhua' | 'webtoon';

export interface MangaExtensionConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly engine: ExtensionEngine;
  readonly category: ExtensionCategory;
  readonly note: string;
  readonly nsfw?: boolean;
  readonly enabled?: boolean;
  readonly desktopOnly?: boolean;
  readonly referer?: string;
  readonly idPattern?: RegExp;
}

export interface MangaExtensionSource {
  readonly config: MangaExtensionConfig;
  ping(): Promise<boolean>;
  find(media: MediaDetail, adultAllowed: boolean): Promise<{ sourceId: string; title: string } | null>;
  chapters(sourceId: string, adultAllowed?: boolean): Promise<Chapter[]>;
  pages(sourceId: string, dataSaver?: boolean): Promise<ChapterPage[]>;
}
