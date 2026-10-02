import type { StoryDocument } from './documents';

/**
 * Josef Hrubý's Dienstbuch (service logbook), 1986–1991.
 * Neat, upright hand, blue ballpoint; occasional Czech. Pre-1996 spelling.
 * "M." first appears in March 1988.
 */
export const DOCS_JOSEF_EARLY: StoryDocument[] = [
  {
    id: 'log_1986_10',
    kind: 'logbook',
    title: { de: 'Dienstbuch, Oktober 1986', en: 'Service logbook, October 1986' },
    date: '1986-10',
    author: 'Josef Hrubý',
    location: 'caretaker_living',
    style: 'handwriting_neat',
    tags: ['josef', 'logbook', 'friedrich', 'marie', 'oma'],
    de: `Dienstbuch Gut Waldegg — J. Hrubý
Oktober 1986

Fr. 3.10. Regen. Dachrinne Nordseite Haupthaus gerichtet, zwei Haken neu. Laub aus dem Brunnenschacht.

Mo. 6.10. Holz für den Winter: 14 Raummeter gespalten und unter Dach. Der Bub hat eine Stunde geholfen, dann Hausübung.

Sa. 11.10. Herr L. spät aus Freistadt zurück, Kotflügel links eingedrückt. Nicht gefragt. Im Haus laut bis Mitternacht. Die Kleine ist im Nachthemd über den Hof herübergekommen, barfuß. Hat bei mir in der Werkstatt gesessen und dem Hasen beim Fressen zugeschaut. Um halb eins hinübergebracht. Frau L. hat die Tür aufgemacht und nichts gesagt.

So. 19.10. Messe in Liebenau. Die alte Frau L. mitgenommen, sie kann die Stiege nicht mehr allein. Kessel im Haupthaus angeheizt. Erster Reif.

Ausgaben: Dichtungen S 38,–  Dachhaken 2 Stk. S 46,–  Mausfallen 4 Stk. S 52,–`,
    en: `Service logbook, Gut Waldegg — J. Hrubý
October 1986

Fri 3 Oct. Rain. Fixed the gutter on the north side of the manor, two new hooks. Leaves cleared out of the well shaft.

Mon 6 Oct. Wood for the winter: 14 cubic metres split and stacked under cover. The boy helped for an hour, then homework.

Sat 11 Oct. Herr L. back late from Freistadt, left wing dented. Did not ask. Loud in the house until midnight. The little one came across the yard in her nightdress, barefoot. Sat with me in the workshop and watched the rabbit eat. Took her back over at half past twelve. Frau L. opened the door and said nothing.

Sun 19 Oct. Mass in Liebenau. Took old Frau L. along, she can no longer manage the stairs alone. Lit the boiler in the manor. First frost.

Expenses: seals S 38.–  gutter hooks x2 S 46.–  mousetraps x4 S 52.–`,
  },
  {
    id: 'log_1987_11',
    kind: 'logbook',
    title: { de: 'Dienstbuch, November 1987', en: 'Service logbook, November 1987' },
    date: '1987-11',
    author: 'Josef Hrubý',
    location: 'workshop',
    style: 'handwriting_neat',
    tags: ['josef', 'logbook', 'disappearance', 'mitten', 'torn_page', 'coal_cellar'],
    de: `Dienstbuch Gut Waldegg
November 1987

Sa. 14.11. Nebel ab Mittag, gegen 3 Uhr so dicht, daß man vom Hof den Stadl nicht sieht. Holz gespalten bis zur Dämmerung. Um ¾ 5 Frau L. am Tor: die Kleine ist nicht beim Hasenstall. Gesucht im Garten, Stadl, Glashaus, Kapelle. Gerufen. Herr L. kommt um 6 Uhr aus Freistadt. Gendarmerie verständigt 18.20 Uhr. Ich gehe mit der Laterne allein den Bachgraben hinunter.

[Das folgende Blatt ist herausgerissen. Am Falz sind noch zwei Wortreste zu lesen: „…arm“ und „…Gott“.]

So. 15.11. Gendarmerie, Feuerwehr Liebenau, Sandl, Windhaag. Hunde. Der Hund verliert die Spur am Wasser. Unterhalb der Klause der Fäustling gefunden, der rote. Frau L. hat ihn in der Küche nicht mehr aus der Hand gegeben.

Mo. 16.11. Bundesheer. Tee gekocht für die Männer, 40 Liter. Kein Hubschrauber wegen dem Nebel.

Mi. 25.11. Die Suche wird eingestellt, sagt der Inspektor. Der Bach ist abgesucht bis zur Aist.

Do. 26.11. Kessel im alten Kohlenkeller wieder in Betrieb. Herr L. hat gefragt, wozu. Gesagt: wegen der Rohre, damit sie nicht einfrieren, jetzt wo im Gesindetrakt keiner mehr wohnt.

Sa. 28.11. Alte Matratze vom Dachboden in den Keller. Zwei Decken aus der Truhe. Jod, Verbandszeug, Wundsalbe — Apotheke Freistadt, nicht Liebenau. Milch 2 l. Grieß.

Herr, Dein Wille geschehe.`,
    en: `Service logbook, Gut Waldegg
November 1987

Sat 14 Nov. Fog from midday; by 3 o'clock so thick you cannot see the barn from the yard. Split wood until dusk. At a quarter to five Frau L. at the gate: the little one is not at the rabbit hutch. Searched the garden, barn, greenhouse, chapel. Called out. Herr L. arrives from Freistadt at 6. Gendarmerie informed 18:20. I take the lantern and go down the stream ravine alone.

[The next leaf has been torn out. Two word fragments survive at the fold: "…arm" and "…God".]

Sun 15 Nov. Gendarmerie, fire brigades from Liebenau, Sandl, Windhaag. Dogs. The dog loses the trail at the water. The mitten found below the old weir, the red one. Frau L. would not let go of it in the kitchen.

Mon 16 Nov. Army. Made tea for the men, 40 litres. No helicopter because of the fog.

Wed 25 Nov. The search is being called off, the inspector says. The stream has been searched down to the Aist.

Thu 26 Nov. Boiler in the old coal cellar back in service. Herr L. asked what for. Told him: for the pipes, so they don't freeze, now nobody lives in the servants' wing.

Sat 28 Nov. Old mattress from the attic down to the cellar. Two blankets from the chest. Iodine, bandages, wound ointment — pharmacy in Freistadt, not Liebenau. Milk 2 l. Semolina.

Lord, Thy will be done.`,
  },
  {
    id: 'log_1988_q1',
    kind: 'logbook',
    title: { de: 'Dienstbuch, Jänner bis April 1988', en: 'Service logbook, January to April 1988' },
    date: '1988-01/1988-04',
    author: 'Josef Hrubý',
    location: 'tunnel',
    style: 'handwriting_neat',
    tags: ['josef', 'logbook', 'oma_death', 'm_first', 'second_plate', 'helga_hears', 'marie_birthday'],
    de: `Dienstbuch — Jänner bis April 1988

Mi. 20.1. –14 Grad. Leitung zur Pumpstation mit der Lötlampe aufgetaut. Im Gang unten die Glühbirne kaputt, neue aus Freistadt. Bis dahin Kerzen.

Do. 11.2. Die alte Frau L. heute früh um 5 Uhr verstorben, im Schlaf. Den Rosenkranz bis zuletzt in der Hand. Doktor aus Liebenau. Ich habe ihr die Augen zugedrückt, weil Herr L. nicht nüchtern war.

So. 14.2. Begräbnis am Hügel. Das Grab mit dem Pammer und seinem Sohn aufgemacht, Boden 30 cm gefroren.

Mi. 9.3. M. 9 Jahre. Gugelhupf. Sie hat die Kerze lange angeschaut.

Sa. 19.3. Frau L. fragt nach Geräuschen in der Nacht, unten. Gesagt: Marder, im Kohlenkeller. Zwei Fallen im Gang aufgestellt, damit sie es sieht, wenn sie nachschaut.

Sa. 2.4. Einkauf Freistadt: Erdäpfel 5 kg, Milch, Grieß, Haferflocken, Äpfel, Lebertran. Zwei Teller und einen Löffel aus der alten Kantine in der Säge geholt, damit oben im Haus nichts fehlt.

M. hat heute zum ersten Mal die ganze Schüssel gegessen. Gesprochen hat sie nicht. Gott sei Dank.`,
    en: `Service logbook — January to April 1988

Wed 20 Jan. –14 degrees. Thawed the pipe to the pump house with the blowlamp. The bulb in the passage below has gone, new one from Freistadt. Candles until then.

Thu 11 Feb. Old Frau L. passed away this morning at 5, in her sleep. Held her rosary to the end. Doctor from Liebenau. I closed her eyes, because Herr L. was not sober.

Sun 14 Feb. Burial on the knoll. Opened the grave with Pammer and his son, ground frozen 30 cm deep.

Wed 9 Mar. M. 9 years. Gugelhupf. She looked at the candle for a long time.

Sat 19 Mar. Frau L. asks about noises in the night, downstairs. Told her: a marten, in the coal cellar. Set two traps in the passage, so she sees them if she looks.

Sat 2 Apr. Shopping in Freistadt: potatoes 5 kg, milk, semolina, oats, apples, cod-liver oil. Fetched two plates and a spoon from the old canteen at the sawmill, so that nothing is missing up in the house.

Today M. ate the whole bowl for the first time. She has not spoken. Thank God.`,
  },
  {
    id: 'log_1991',
    kind: 'logbook',
    title: { de: 'Dienstbuch, März bis Juni 1991', en: 'Service logbook, March to June 1991' },
    date: '1991-03/1991-06',
    author: 'Josef Hrubý',
    location: 'manor_basement_boiler',
    style: 'handwriting_neat',
    tags: ['josef', 'logbook', 'helga_taken', 'wall', 'sealed_room', 'key_clue'],
    de: `Dienstbuch — 1991

Di. 12.3. Frau L. heute mit der Rettung nach Linz. Dr. Wallner aus Freistadt war da und der Herr vom Gemeindeamt. Sie hat sich am Stiegengeländer angehalten und ins Haus hineingerufen, immer den einen Namen. Ich habe ihre Finger vom Geländer gelöst, einen nach dem anderen. Sie hat mich angeschaut, als ob sie mich nicht kennt.
Abends Kapelle. Rosenkranz, der schmerzhafte.
M. war ruhig. Die Tür unten war zu.

Di. 2.4. Brief von der Klinik in Linz. Ihre Sachen hingeschickt: Strickzeug, Nachthemden, das Bild.

Mo. 10.6. Vom Bezirksgericht angekündigt: ein Sachverständiger für die Schätzung, am Freitag.

Di. 11.6. Durchgang vom Heizkeller zum alten Kohlenkeller zugemauert. Ziegel aus dem Stadl, 2 Sack Zement. Verputzt und gekalkt, damit es alt ausschaut. Die Stellage mit den Einmachgläsern davor. Die Tür vom Gang her bleibt.

Fr. 14.6. Sachverständiger da, 3 Stunden. Hat im Keller nur auf die Feuchtigkeit geschaut.

Jetzt sind wir allein. M. darf bei Tag hinauf, in die Küche. Sie steht lang am Fenster.`,
    en: `Service logbook — 1991

Tue 12 Mar. Frau L. taken to Linz by ambulance today. Dr. Wallner from Freistadt was here, and the man from the municipal office. She held on to the banister and called into the house, always the one name. I loosened her fingers from the banister, one after the other. She looked at me as if she did not know me.
Evening in the chapel. Rosary, the Sorrowful Mysteries.
M. was quiet. The door below was shut.

Tue 2 Apr. Letter from the clinic in Linz. Sent her things over: knitting, nightdresses, the picture.

Mon 10 Jun. Notice from the district court: a surveyor coming for the valuation, on Friday.

Tue 11 Jun. Walled up the opening between the boiler cellar and the old coal cellar. Bricks from the barn, 2 sacks of cement. Plastered and limewashed so it looks old. The shelf with the preserving jars in front of it. The door from the passage stays.

Fri 14 Jun. Surveyor here, 3 hours. In the cellar he only looked at the damp.

Now we are alone. M. may come up in the daytime, into the kitchen. She stands at the window for a long time.`,
  },
];
