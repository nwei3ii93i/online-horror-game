/**
 * Short texts rendered INTO textures: signs, labels, carvings, inscriptions.
 * `de` is what is physically written; `en` is an optional subtitle/transcript.
 * Hands: 'friedrich' (blue ballpoint, sloping), 'helga' (neat Kurrent-influenced
 * school hand), 'josef' (upright, careful, carpenter's pencil), 'later' (large,
 * round, child-like letters by an adult: M.), 'print'/'carved'/'painted'.
 *
 * SPOILERS: see README.md for what these details mean.
 */

import type { StoryLocation } from './documents';

export type EnvHand = 'friedrich' | 'helga' | 'josef' | 'later' | 'oma' | 'print' | 'carved' | 'painted' | 'stencil' | 'enamel' | 'dymo';

export interface EnvLine { de: string; en?: string; hand?: EnvHand }

export interface HeightMark {
  label: string;
  name: 'Thomas' | 'Marie' | 'M';
  year: number;
  heightCm: number;
  pen: 'ballpoint_blue' | 'carpenter_pencil';
  hand: EnvHand;
}

export interface Gravestone {
  id: string;
  kind: 'family_tomb' | 'small_stone' | 'iron_cross' | 'wooden_cross';
  lines: string[];
  en?: string[];
  /** Placement / dressing hint for the level builder. */
  note?: string;
}

export interface JarLabel { de: string; hand: EnvHand; fill: number; note?: string }

export interface Headline { paper: string; date: string; headline: string; en: string }

export interface BoxLabel { de: string; en: string; hand: EnvHand; contents: 'full' | 'half' | 'empty'; note?: string }

export const ENV_TEXT = {
  /** Kitchen door frame (manor), on the jamb towards the Speis. Left edge, floor = 0 cm. */
  heightMarks: {
    location: 'manor_kitchen' as StoryLocation,
    marks: [
      { label: 'Thomas 1978', name: 'Thomas', year: 1978, heightCm: 103, pen: 'ballpoint_blue', hand: 'friedrich' },
      { label: 'Thomas 1980', name: 'Thomas', year: 1980, heightCm: 117, pen: 'ballpoint_blue', hand: 'friedrich' },
      { label: 'Thomas 1982', name: 'Thomas', year: 1982, heightCm: 129, pen: 'ballpoint_blue', hand: 'friedrich' },
      { label: 'Thomas 1984', name: 'Thomas', year: 1984, heightCm: 141, pen: 'ballpoint_blue', hand: 'helga' },
      { label: 'Thomas 1986', name: 'Thomas', year: 1986, heightCm: 152, pen: 'ballpoint_blue', hand: 'helga' },
      { label: 'Marie 1982', name: 'Marie', year: 1982, heightCm: 95, pen: 'ballpoint_blue', hand: 'friedrich' },
      { label: 'Marie 1984', name: 'Marie', year: 1984, heightCm: 108, pen: 'ballpoint_blue', hand: 'helga' },
      { label: 'Marie 1986', name: 'Marie', year: 1986, heightCm: 121, pen: 'ballpoint_blue', hand: 'helga' },
      { label: 'Marie 1987', name: 'Marie', year: 1987, heightCm: 127, pen: 'ballpoint_blue', hand: 'helga' },
      // Different pen, different hand, no first name. Short straight lines drawn against a ruler.
      { label: 'M 1988', name: 'M', year: 1988, heightCm: 132, pen: 'carpenter_pencil', hand: 'josef' },
      { label: 'M 1990', name: 'M', year: 1990, heightCm: 141, pen: 'carpenter_pencil', hand: 'josef' },
      { label: 'M 1993', name: 'M', year: 1993, heightCm: 155, pen: 'carpenter_pencil', hand: 'josef' },
      { label: 'M 1996', name: 'M', year: 1996, heightCm: 161, pen: 'carpenter_pencil', hand: 'josef' },
      { label: 'M 1999', name: 'M', year: 1999, heightCm: 163, pen: 'carpenter_pencil', hand: 'josef' },
    ] as HeightMark[],
  },

  /** Small family cemetery on the knoll NE of the manor. */
  gravestones: [
    {
      id: 'tomb_lindner',
      kind: 'family_tomb',
      lines: [
        'FAMILIE LINDNER',
        'Hier ruhen in Gott',
        'Anton Lindner',
        'Holzhändler und Sägewerksbesitzer',
        '* 3. 4. 1879   † 17. 9. 1951',
        'Maria Lindner geb. Pötscher',
        '* 12. 1. 1884   † 2. 2. 1962',
        'Karl Lindner',
        '* 6. 10. 1910   † 23. 3. 1969',
        'Theresia Lindner geb. Kapeller',
        '* 21. 8. 1912   † 11. 2. 1988',
        'R. I. P.',
      ],
      en: [
        'THE LINDNER FAMILY', 'Resting in God', 'Anton Lindner', 'Timber merchant and sawmill owner',
        'b. 3 Apr 1879 – d. 17 Sep 1951', 'Maria Lindner née Pötscher', 'b. 12 Jan 1884 – d. 2 Feb 1962',
        'Karl Lindner', 'b. 6 Oct 1910 – d. 23 Mar 1969', 'Theresia Lindner née Kapeller',
        'b. 21 Aug 1912 – d. 11 Feb 1988', 'R.I.P.',
      ],
      note: 'Granite, gilded letters; the last name is cut more sharply than the others.',
    },
    {
      id: 'stone_anna',
      kind: 'small_stone',
      lines: ['Anna Lindner', '* 2. 5. 1934   † 19. 7. 1934', 'Ein Engel mehr im Himmel'],
      en: ['Anna Lindner', 'b. 2 May 1934 – d. 19 Jul 1934', 'One more angel in heaven'],
      note: 'Small sandstone, lichen; a stone lamb on top with its head worn away.',
    },
    {
      id: 'cross_marie',
      kind: 'iron_cross',
      lines: ['MARIE LINDNER', '* 1979'],
      en: ['MARIE LINDNER', 'b. 1979'],
      note: 'Small wrought-iron cross, enamel plate. No death date: there is space left for it. No grave mound in front, only a little bed of moss. Often a fresh candle stub here.',
    },
    {
      id: 'cross_nameless',
      kind: 'wooden_cross',
      lines: [],
      note: 'Plain cross of two spruce battens, nailed, no name. At the edge of the cemetery under three spruces, outside the iron fence line. A grey felt hat hangs on it, weathered. Several glass candle holders, some soot fresh. This is the grave in the chapel drawing ("J. SCHLAFT").',
    },
  ] as Gravestone[],

  chapel: {
    votivePlaque: { de: 'Maria hilf! 1923\nGestiftet von Anton und Maria Lindner\nzum Dank für die glückliche Vollendung des Hauses', en: 'Mary, help us! 1923\nDonated by Anton and Maria Lindner\nin thanks for the safe completion of the house', hand: 'painted' } as EnvLine,
    lintel: { de: 'A ✝ L   1923   M ✝ L', hand: 'carved' } as EnvLine,
    offeringBox: { de: 'Opferstock — Vergelt\'s Gott', en: 'Offerings — God reward you', hand: 'painted' } as EnvLine,
    /** Tucked into the frame of the votive picture, recent paper. */
    tuckedCard: { de: 'FÜR J. UND FÜR MAMA', en: 'FOR J. AND FOR MAMA', hand: 'later' } as EnvLine,
  },

  signs: {
    privateProperty: { de: 'PRIVATGRUND\nBetreten verboten', en: 'PRIVATE PROPERTY\nNo trespassing', hand: 'enamel' } as EnvLine,
    privateRoad: { de: 'Privatweg — Fahrverbot\nausgenommen Anrainer', en: 'Private road — no vehicles\nexcept residents', hand: 'enamel' } as EnvLine,
    gate: { de: 'GUT WALDEGG', hand: 'carved' } as EnvLine,
    highVoltage: { de: 'ACHTUNG HOCHSPANNUNG\nLebensgefahr', en: 'DANGER HIGH VOLTAGE\nRisk of death', hand: 'enamel' } as EnvLine,
    danger: { de: 'LEBENSGEFAHR\nBetreten des Schachtes verboten', en: 'DANGER OF DEATH\nDo not enter the shaft', hand: 'enamel' } as EnvLine,
    sawmill: { de: 'SÄGEWERK LINDNER\nHolzhandel · Schnittholz · gegr. 1923', en: 'LINDNER SAWMILL\nTimber · sawn wood · est. 1923', hand: 'painted' } as EnvLine,
    caretakerDoor: { de: 'Verwaltung', en: 'Estate office', hand: 'enamel' } as EnvLine,
    workshop: { de: 'Werkstätte — Rauchen verboten!', en: 'Workshop — no smoking!', hand: 'painted' } as EnvLine,
    pumphouse: { de: 'Pumpstation · Wasserversorgung Gut Waldegg · 1958', en: 'Pump house · Waldegg estate water supply · 1958', hand: 'enamel' } as EnvLine,
    tunnelStencils: [
      { de: 'HEIZGANG 1958', hand: 'stencil' },
      { de: 'KOHLE →', en: 'COAL →', hand: 'stencil' },
      { de: '← PUMPE', en: '← PUMP', hand: 'stencil' },
    ] as EnvLine[],
    /** Taped on the generator in the pump house. Josef wrote the first line; the second is a copy in another hand. */
    generatorLabel: [
      { de: 'Hahn auf — Choke — 2 x ziehen, nicht reißen!', en: 'Tap open — choke — pull twice, don\'t yank!', hand: 'josef' },
      { de: '2 x ziehen', en: 'pull twice', hand: 'later' },
    ] as EnvLine[],
    fuseBox: [
      { de: 'Küche', hand: 'dymo' }, { de: 'Stiege', hand: 'dymo' }, { de: 'Salon', hand: 'dymo' },
      { de: 'Keller vorne', hand: 'dymo' }, { de: 'Keller hinten', hand: 'josef' },
    ] as EnvLine[],
  },

  mailbox: {
    location: 'road_mailbox' as StoryLocation,
    namePlate: [
      { de: 'LINDNER', hand: 'carved' },
      { de: 'HRUBÝ', hand: 'dymo' },
    ] as EnvLine[],
    /** Newer than everything else on the box. */
    sticker: { de: 'Bitte keine Werbung!', en: 'No junk mail please!', hand: 'print' } as EnvLine,
  },

  /** Manor kitchen blackboard, untouched since November 1987. */
  kitchenBlackboard: { de: 'Wolle rot · Grieß · Germ · Zündhölzer · Tierarzt (Stupsi)', en: 'Red wool · semolina · yeast · matches · vet (Stupsi)', hand: 'helga' } as EnvLine,

  /** Speis (pantry) shelf. fill: 0 = empty jar. */
  pantryJars: [
    { de: 'Marillenmarmelade 1986', hand: 'helga', fill: 0.9 },
    { de: 'Kirschen 1986', hand: 'helga', fill: 1 },
    { de: 'Hollersaft 1986', hand: 'helga', fill: 0.6 },
    { de: 'Rote Rüben 1985', hand: 'helga', fill: 1 },
    { de: 'Zwetschkenröster 1987', hand: 'helga', fill: 1 },
    { de: 'Essiggurkerl 1987', hand: 'helga', fill: 0.8 },
    { de: 'Ribiseln 1987', hand: 'helga', fill: 0, note: 'Empty, washed, upside down on a clean cloth.' },
    { de: 'Heidelbeeren 1994', hand: 'josef', fill: 1 },
    { de: 'Preiselbeeren 1999', hand: 'josef', fill: 0.5 },
    { de: 'Ribiseln 2009', hand: 'later', fill: 1 },
    { de: 'Marillen 2012', hand: 'later', fill: 0.7 },
    { de: 'Zwetschken 2016', hand: 'later', fill: 1, note: 'Label stuck on crooked; lid still bright.' },
    { de: 'Paradeiser 2018', hand: 'later', fill: 1 },
  ] as JarLabel[],

  /** Papers lying around (stacks, kindling, lining drawers). Not about the case. */
  newspaperHeadlines: [
    { paper: 'Oberösterreichische Nachrichten', date: '1987-10-21', headline: 'Börsenkrach: Auch Wien im Sog', en: 'Stock market crash: Vienna dragged down too' },
    { paper: 'Mühlviertler Bote', date: '1987-12-03', headline: 'Neues Feuerwehrhaus in Sandl gesegnet', en: 'New fire station blessed in Sandl' },
    { paper: 'Oberösterreichische Nachrichten', date: '1988-02-16', headline: 'Waldheim: „Ich trete nicht zurück“', en: 'Waldheim: "I will not resign"' },
    { paper: 'Oberösterreichische Nachrichten', date: '1989-07-18', headline: 'Beitrittsantrag in Brüssel überreicht', en: 'EC membership application handed over in Brussels' },
    { paper: 'Oberösterreichische Nachrichten', date: '1989-12-18', headline: 'Mock und Dienstbier durchtrennen den Stacheldraht', en: 'Mock and Dienstbier cut through the barbed wire' },
    { paper: 'Mühlviertler Bote', date: '1990-01-11', headline: 'Grenze offen: Ansturm auf die Geschäfte in Freistadt', en: 'Border open: shops in Freistadt overrun' },
    { paper: 'Oberösterreichische Nachrichten', date: '1990-10-08', headline: 'Nationalratswahl: SPÖ bleibt Erste', en: 'General election: Social Democrats stay first' },
    { paper: 'Oberösterreichische Nachrichten', date: '1991-01-17', headline: 'Golfkrieg: Alliierte greifen Bagdad an', en: 'Gulf War: allies attack Baghdad' },
    { paper: 'Mühlviertler Bote', date: '1991-05-23', headline: 'Frost im Mai: Obstbauern fürchten um die Ernte', en: 'Frost in May: fruit growers fear for the harvest' },
    { paper: 'Oberösterreichische Nachrichten', date: '1992-05-25', headline: 'Klestil ist neuer Bundespräsident', en: 'Klestil is the new Federal President' },
    { paper: 'Oberösterreichische Nachrichten', date: '1993-01-25', headline: 'Lichtermeer am Heldenplatz', en: 'Sea of lights on Heldenplatz' },
    { paper: 'Mühlviertler Bote', date: '1993-02-04', headline: 'OKA: Strom wird ab März teurer', en: 'Electricity company: power to cost more from March' },
  ] as Headline[],

  calendar: {
    months: ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
    monthsEn: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    weekdays: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
    /** Wall calendars in the world, and the page they hang open at (1–12). */
    hanging: [
      { title: 'Raiffeisenkasse Liebenau · 1987', location: 'manor_kitchen' as StoryLocation, year: 1987, openAt: 11, note: 'Never turned past November.' },
      { title: 'Lagerhaus Freistadt · 1993', location: 'pumphouse' as StoryLocation, year: 1993, openAt: 2 },
      { title: 'Pfarrkalender 2019 · Pfarre Liebenau', location: 'caretaker_kitchen' as StoryLocation, year: 2019, openAt: 11, note: 'See document calendar_2019_11.' },
    ],
  },

  /** Library and study shelves. */
  bookSpines: [
    'Goethe · Faust', 'Schiller · Werke III', 'Stifter · Der Hochwald', 'Stifter · Bunte Steine',
    'Stifter · Der Nachsommer I', 'Stifter · Der Nachsommer II', 'Grillparzer · Der arme Spielmann',
    'Ebner-Eschenbach · Dorf- und Schloßgeschichten', 'Rosegger · Als ich noch der Waldbauernbub war',
    'Ganghofer · Das Schweigen im Walde', 'Storm · Der Schimmelreiter', 'Hesse · Unterm Rad',
    'Roth · Radetzkymarsch', 'Zweig · Die Welt von Gestern', 'Rilke · Das Stunden-Buch',
    'Grimm · Kinder- und Hausmärchen', 'Hauff · Märchen', 'Karl May · Winnetou I', 'Karl May · Der Schatz im Silbersee',
    'Österreichisches Wörterbuch', 'Oberösterreichischer Heimatkalender 1956', 'Mühlviertler Heimatblätter 1962',
    'Österreichischer Bauernkalender 1951', 'Katholischer Hauskalender 1975', 'Forst- und Jagdzeitung 1959',
    'Holz-Kurier · Jahrgang 1968', 'Bauernregeln fürs ganze Jahr',
    'Sägewerk Lindner · Holzbuch 1949–1958', 'Sägewerk Lindner · Hauptbuch 1961–1971',
  ],

  /** Cardboard boxes on the Dachboden, labelled in Helga's hand (felt pen). */
  atticBoxes: [
    { de: 'Weihnachten', en: 'Christmas', hand: 'helga', contents: 'full' },
    { de: 'Christbaumschmuck — Vorsicht Glas!', en: 'Tree decorations — careful, glass!', hand: 'helga', contents: 'full' },
    { de: 'Fasching', en: 'Carnival costumes', hand: 'helga', contents: 'half' },
    { de: 'Thomas Schule', en: 'Thomas school', hand: 'helga', contents: 'full' },
    { de: 'Thomas — Kleider 140–152', en: 'Thomas — clothes 140–152', hand: 'helga', contents: 'full' },
    { de: 'Marie — Spielsachen', en: 'Marie — toys', hand: 'helga', contents: 'half' },
    { de: 'Marie — Kleider 104–122', en: 'Marie — clothes 104–122', hand: 'helga', contents: 'full' },
    { de: 'Marie — Kleider 128–134 (für Herbst 87)', en: 'Marie — clothes 128–134 (for autumn 87)', hand: 'helga', contents: 'empty', note: 'Opened neatly along the tape and closed again. Nothing inside.' },
    { de: 'Oma — Wäsche', en: 'Oma — linen', hand: 'helga', contents: 'full' },
    { de: 'Vorhänge Salon (alt)', en: 'Drawing-room curtains (old)', hand: 'helga', contents: 'full' },
    { de: 'Fotos 1960–1975', en: 'Photos 1960–1975', hand: 'friedrich', contents: 'full' },
    { de: 'Sägewerk Akten 1965–1971', en: 'Sawmill files 1965–1971', hand: 'friedrich', contents: 'full' },
    { de: 'Einsiedegläser leer', en: 'Preserving jars, empty', hand: 'helga', contents: 'half' },
  ] as BoxLabel[],

  huntingStand: {
    plate: { de: 'Hochstand Lindnerwiese', hand: 'painted' } as EnvLine,
    carving: { de: 'J.H. 1962', hand: 'carved' } as EnvLine,
    /** Lower on the same post, small, the cut wood still pale. */
    laterCarving: { de: 'M', hand: 'carved' } as EnvLine,
  },

  /**
   * Scratched with a nail into the plaster of the sealed room, groups of five
   * (four strokes, one across). One row = one year of days: 73 groups.
   * Total 1296 marks = days from 26 Nov 1987 (boiler in the coal cellar lit) to
   * 14 Jun 1991 ("Now we are alone"). Starts neat and small, ends large and heavy.
   */
  sealedRoomTally: {
    location: 'manor_basement_sealed_room' as StoryLocation,
    groupSize: 5,
    rows: [365, 365, 365, 201],
    totalMarks: 1296,
    /** Also scratched, small, near the first row. */
    words: [
      { de: 'MAMA', hand: 'later' },
      { de: 'STUPSI', hand: 'later' },
    ] as EnvLine[],
    /** A circle with a face, scratched above the last row: a moon. */
    scratchedMoon: true,
  },

  /** Painted pine chest. Stood in Marie's room (an unfaded rectangle on the floorboards); now in the sealed room. */
  toyBox: {
    location: 'manor_basement_sealed_room' as StoryLocation,
    lid: { de: 'Marie', hand: 'painted' } as EnvLine,
    lidSmall: { de: 'J.H. 1984', hand: 'painted' } as EnvLine,
    insideLid: { de: 'STUPSI WOHNT HIER', en: 'STUPSI LIVES HERE', hand: 'later' } as EnvLine,
    note: 'Bauernmalerei: tulips and a rabbit around the name. Inside: a carved wooden rabbit, worn smooth.',
  },

  /** Fourteen jerrycans in the barn, numbered in paint by Josef. */
  dieselCans: {
    location: 'barn' as StoryLocation,
    labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'],
    hand: 'josef' as EnvHand,
    note: 'Labels in Josef\'s paint; most cans are recent, plastic, with the old numbers copied onto them in round marker letters.',
  },
} as const;
