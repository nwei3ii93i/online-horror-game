import type { StoryDocument } from './documents';

/**
 * Josef Hrubý's Dienstbuch, 1993–2003. The hand stays neat until 2001, then shakes.
 * Czech lines stay untranslated in the English transcript on purpose (see README).
 */
export const DOCS_JOSEF_LATE: StoryDocument[] = [
  {
    id: 'log_1993',
    kind: 'logbook',
    title: { de: 'Dienstbuch, Jänner und Februar 1993', en: 'Service logbook, January and February 1993' },
    date: '1993-01/1993-02',
    author: 'Josef Hrubý',
    location: 'pumphouse',
    style: 'handwriting_neat',
    tags: ['josef', 'logbook', 'power_cut', 'generator', 'm_sleeps'],
    de: `Dienstbuch — Jänner/Februar 1993

Mo. 18.1. Zwei Männer von der OKA. Zähler im Haupthaus und im Verwalterhaus abgelesen und plombiert. Rückstand seit 1990, sagt der eine, die Erben zahlen nicht. Ab heute kein Strom.

Di. 19.1. Das alte Aggregat aus der Säge (Deutz, Bj. 1964) mit dem Traktor vom Pammer heraufgeholt. In der Pumpstation aufgestellt, Auspuff durch die Mauer. Kabel durch den Gang zum Haupthaus, an der Decke entlang, mit Schellen.

Di. 26.1. Aggregat läuft. 4 Stunden am Abend, 1 Stunde in der Früh für die Pumpe. Verbrauch ca. 1,5 l in der Stunde.
M. schläft besser, wenn das Aggregat läuft. Wenn es aus ist, setzt sie sich auf und horcht. Jetzt laß ich es laufen, bis sie eingeschlafen ist.

Mi. 3.2. Diesel 60 l, Lagerhaus Freistadt, S 552,–. Kanister in den Stadl, nicht ins Haus.
Frau L. hat aus Linz geschrieben, ob das Haus noch steht. Geantwortet: ja, alles in Ordnung.`,
    en: `Service logbook — January/February 1993

Mon 18 Jan. Two men from the electricity company. Read and sealed the meters in the manor and the caretaker's house. Arrears since 1990, one of them says, the heirs don't pay. No power from today.

Tue 19 Jan. Brought the old generator up from the sawmill (Deutz, built 1964) with Pammer's tractor. Set it up in the pump house, exhaust through the wall. Cable through the passage to the manor, along the ceiling, with clamps.

Tue 26 Jan. Generator running. 4 hours in the evening, 1 hour in the morning for the pump. Uses about 1.5 l an hour.
M. sleeps better when the generator is running. When it is off she sits up and listens. Now I let it run until she has fallen asleep.

Wed 3 Feb. Diesel 60 l, co-op store Freistadt, S 552.–. Cans to the barn, not into the house.
Frau L. wrote from Linz, asking whether the house is still standing. Answered: yes, all in order.`,
  },
  {
    id: 'log_1997',
    kind: 'logbook',
    title: { de: 'Dienstbuch, 1997', en: 'Service logbook, 1997' },
    date: '1997',
    author: 'Josef Hrubý',
    location: 'caretaker_cellar',
    style: 'handwriting_neat',
    tags: ['josef', 'logbook', 'marie_birthday', 'findetag', 'newspaper_1997', 'moon_song', 'car_at_gate'],
    de: `Dienstbuch — 1997

So. 9.3. M. 18 Jahre. Kuchen mit der Ribiselmarmelade von 1987, das letzte Glas von Frau L. Sie wollte die Kerzen nicht ausblasen. Wir haben sie brennen lassen, bis sie von selbst aus waren.
Das Lesebuch zum vierten Mal von vorn. Sie liest jetzt selber, laut, aber nur, wenn ich nicht hinschau.

Fr. 14.11. Findetag. Zehn Jahre. Gugelhupf, eine Kerze.
In der Zeitung steht es auch, zehn Jahre. Ein altes Bild vom Haus. Den Thomas haben sie auch gefragt. Zeitung in den Ofen.

Sa. 15.11. Ein Auto am Tor, zwei Stunden. Ein Mann mit Fotoapparat. Licht aus, Aggregat aus. M. hat die ganze Zeit meine Hand gehalten, so fest, daß es weh getan hat.

Mi. 24.12. Hl. Abend. Christbaum aus dem Wald, ein kleiner. Sie hat gesungen. Das Lied vom Mond, alle Strophen. Ich habe nicht gewußt, daß sie es kann.

Diesel 1997 gesamt: 610 l, S 5.795,–`,
    en: `Service logbook — 1997

Sun 9 Mar. M. 18 years. Cake with the redcurrant jam from 1987, Frau L.'s last jar. She didn't want to blow out the candles. We let them burn until they went out by themselves.
The reader from the beginning for the fourth time. She reads by herself now, aloud, but only when I'm not looking.

Fri 14 Nov. Finding Day. Ten years. Gugelhupf, one candle.
It's in the newspaper as well, ten years. An old picture of the house. They asked Thomas too. Newspaper into the stove.

Sat 15 Nov. A car at the gate, two hours. A man with a camera. Lights out, generator off. M. held my hand the whole time, so tight it hurt.

Wed 24 Dec. Christmas Eve. A tree from the forest, a small one. She sang. The moon song, every verse. I did not know she could.

Diesel 1997 total: 610 l, S 5,795.–`,
  },
  {
    id: 'log_2001_2003',
    kind: 'logbook',
    title: { de: 'Dienstbuch, 2001 bis 2003', en: 'Service logbook, 2001 to 2003' },
    date: '2001-09/2003-12',
    author: 'Josef Hrubý',
    location: 'caretaker_bedroom',
    style: 'handwriting_shaky',
    tags: ['josef', 'logbook', 'illness', 'generator_lesson', 'chapel_key', 'czech', 'findetag', 'last_entry'],
    de: `Dienstbuch — 2001 bis 2003

So. 30.9.01 Mondnacht. Mit M. draußen, bis zum Waldrand und zurück. Zum ersten Mal seit damals. Sie hat die Bäume gezählt, vierzig. Sie ist jetzt größer als ich.

Mi. 9.1.02 Diesel jetzt in Euro. 100 l € 71,–. Ich rechne es immer noch in Schilling um.
Husten seit Allerheiligen. Dr. Wallner sagt: Lunge, nach Freistadt ins Spital, Röntgen. Nein.

So. 9.3.03 M. 24. Den Kuchen hat sie selbst gemacht. Zu viel Zucker. Sehr gut.

Mo. 20.10.03 Ihr gezeigt, wie man das Aggregat anwirft: Hahn auf, Choke, zweimal ziehen, nicht reißen. Sie hat es gleich gekonnt. Wo die Kanister stehen. Wo das Geld ist (Blechdose, Werkstatt, unter der Hobelbank). Wie man beim Lagerhaus bestellt, mit Brief. Die Briefmarken.
Kapelle bei Nacht: wo der Schlüssel liegt, wo die Kerzen sind. Wo die Schaufel steht.

Fr. 14.11.03 Findetag. Sechzehn Jahre.
Nevzal jsem ji. Našel jsem ji. Pán Bůh mi ji vrátil.

Mo. 8.12.03 Maria Empfängnis. Die Stiege geht nicht mehr. M. bringt mir das Essen herüber, über den Hof. Jetzt sie mir.
Was wird aus ihr.
Pane Bože, odpusť mi.

[Die restlichen Seiten sind leer.]`,
    en: `Service logbook — 2001 to 2003

Sun 30 Sep 01. Moonlit night. Outside with M., as far as the edge of the forest and back. The first time since then. She counted the trees, forty. She is taller than me now.

Wed 9 Jan 02. Diesel in euros now. 100 l € 71.–. I still convert it to schillings.
Cough since All Saints. Dr. Wallner says: lungs, hospital in Freistadt, X-ray. No.

Sun 9 Mar 03. M. 24. She made the cake herself. Too much sugar. Very good.

Mon 20 Oct 03. Showed her how to start the generator: open the tap, choke, pull twice, don't yank. She managed it straight away. Where the cans are. Where the money is (tin box, workshop, under the workbench). How to order from the co-op, by letter. The stamps.
The chapel at night: where the key is kept, where the candles are. Where the shovel stands.

Fri 14 Nov 03. Finding Day. Sixteen years.
[in Czech:] Nevzal jsem ji. Našel jsem ji. Pán Bůh mi ji vrátil.

Mon 8 Dec 03. Immaculate Conception. I can't manage the stairs any more. M. brings my food across the yard. Now she does it for me.
What will become of her.
[in Czech:] Pane Bože, odpusť mi.

[The remaining pages are blank.]`,
  },
];
