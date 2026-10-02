/**
 * In-world documents of Gut Waldegg.
 *
 * `de` is the in-world text exactly as it appears on paper (Austrian German, period
 * spelling: pre-1996 orthography such as "daß" / "vermißt" for anything written before
 * the reform). `en` is the English transcript shown to the player.
 *
 * Lines in Czech inside Josef Hrubý's logbook are intentionally left untranslated in
 * both versions (the English transcript only marks them). The translation lives in
 * README.md for developers.
 *
 * SPOILERS: see README.md in this folder for the truth behind these texts and the
 * recommended placement / discovery order.
 */

export type StoryDocumentKind =
  | 'letter' | 'diary' | 'logbook' | 'newspaper' | 'note' | 'receipt' | 'telegram'
  | 'drawing' | 'calendar' | 'postcard' | 'official' | 'parte' | 'list' | 'photo_back';

export type StoryDocumentStyle =
  | 'handwriting_neat' | 'handwriting_shaky' | 'handwriting_child' | 'typewriter' | 'print' | 'stamp';

export type StoryLocation =
  | 'manor_hall' | 'manor_salon' | 'manor_dining' | 'manor_kitchen' | 'manor_pantry'
  | 'manor_study' | 'manor_library' | 'manor_master_bedroom' | 'manor_marie_room'
  | 'manor_thomas_room' | 'manor_oma_room' | 'manor_bathroom' | 'manor_attic'
  | 'manor_basement_boiler' | 'manor_basement_storage' | 'manor_basement_sealed_room'
  | 'tunnel' | 'pumphouse' | 'caretaker_kitchen' | 'caretaker_living' | 'caretaker_bedroom'
  | 'caretaker_cellar' | 'workshop' | 'barn' | 'greenhouse' | 'chapel' | 'cemetery'
  | 'hunting_stand' | 'road_mailbox';

export interface StoryDocument {
  id: string;
  kind: StoryDocumentKind;
  title: { de: string; en: string };
  date?: string;
  author?: string;
  /** Where it is found (one of the StoryLocation ids). */
  location: StoryLocation;
  style: StoryDocumentStyle;
  de: string;
  en: string;
  tags?: string[];
}

import { DOCS_JOSEF_EARLY } from './docs_josef_early';
import { DOCS_JOSEF_LATE } from './docs_josef_late';
import { DOCS_FAMILY } from './docs_family';
import { DOCS_OFFICIAL } from './docs_official';
import { DOCS_AFTER } from './docs_after';

/** All documents, roughly in chronological order of the events they belong to. */
export const DOCUMENTS: StoryDocument[] = [
  ...DOCS_FAMILY,
  ...DOCS_OFFICIAL,
  ...DOCS_JOSEF_EARLY,
  ...DOCS_JOSEF_LATE,
  ...DOCS_AFTER,
];

export const DOCUMENTS_BY_ID: Readonly<Record<string, StoryDocument>> = Object.fromEntries(
  DOCUMENTS.map((d) => [d.id, d]),
);

export function documentsAt(location: StoryLocation): StoryDocument[] {
  return DOCUMENTS.filter((d) => d.location === location);
}
