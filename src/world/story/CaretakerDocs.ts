import type { DocPlacement } from './DocumentProps';
import { CARETAKER, CARETAKER_SPOTS, mailboxNotePose } from '../buildings/Caretaker';

/**
 * Where the caretaker documents lie (DocPlacement as in MANOR_DOCS: flat on a surface with
 * y = top of that surface, or pinned to a wall with `wall` = outward normal [x, z]).
 *
 *  kitchen   – calendar_2019_11 hangs on the north wall between window and back door;
 *              news_ooen_1997_11_14 lies on the wood box beside the Sparherd (charred scraps by the
 *              fire door: "Zeitung in den Ofen").
 *  living    – log_1986_10 and clinic_letter_1991 on the table in the Herrgottswinkel.
 *  bedroom   – log_2001_2003 on the nightstand, parte_josef_2004 on the desk under the window.
 *  cellar    – log_1997 on the jar shelf (north cellar), next to a storm lantern.
 *  mailbox   – mailbox_delivery_note_2017 inside the rusted mailbox outside the gate (front flap
 *              hangs open); same position as the building's 'road_mailbox' anchor.
 *
 * The mailbox stands on the terrain: CARETAKER_DOCS has its height baked for the default seed
 * 1987, caretakerDocs(heightAt) computes it for any terrain.
 */
const { C0, G0 } = CARETAKER;
const S = CARETAKER_SPOTS;

const INDOOR: DocPlacement[] = [
  { id: 'calendar_2019_11', x: S.calendar.x, y: S.calendar.y, z: S.calendar.z + 0.004, rot: 0.015, wall: [0, 1] },
  { id: 'news_ooen_1997_11_14', x: S.woodBox.x, y: S.woodBox.top, z: S.woodBox.z, rot: 0.35 },
  { id: 'log_1986_10', x: S.livingTable.x - 0.3, y: S.livingTable.top, z: S.livingTable.z + 0.05, rot: 0.25 },
  { id: 'clinic_letter_1991', x: S.livingTable.x + 0.35, y: S.livingTable.top, z: S.livingTable.z + 0.1, rot: -0.12 },
  { id: 'log_2001_2003', x: 33.2, y: G0 + 0.7, z: 4.78, rot: -0.2 },
  { id: 'parte_josef_2004', x: 33.55, y: G0 + 0.83, z: 7.2, rot: 0.1 },
  { id: 'log_1997', x: S.jarShelf.x1 - 0.48, y: C0 + S.jarShelf.boards[1] + 0.0125, z: S.jarShelf.z0 + S.jarShelf.depth / 2, rot: 0.08 },
];

/** Delivery note inside the mailbox, default seed (1987) terrain. */
const MAILBOX_1987 = { x: 27.7288, y: 1.8475, z: 26.3810, rot: 0.6958 };

export const CARETAKER_DOCS: DocPlacement[] = [
  ...INDOOR,
  { id: 'mailbox_delivery_note_2017', ...MAILBOX_1987 },
];

/** Caretaker documents with the mailbox note placed on the actual terrain (any seed). */
export function caretakerDocs(heightAt?: (x: number, z: number) => number): DocPlacement[] {
  if (!heightAt) return CARETAKER_DOCS;
  const p = mailboxNotePose(heightAt);
  return [...INDOOR, { id: 'mailbox_delivery_note_2017', x: p.x, y: p.y, z: p.z, rot: p.rot }];
}
