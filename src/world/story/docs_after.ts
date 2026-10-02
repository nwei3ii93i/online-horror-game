import type { StoryDocument } from './documents';

/**
 * Everything that should not exist: purchases for a growing girl, later drawings,
 * the unsent Parte, and traces from long after 2004. Drawings are rendered
 * procedurally; the bracketed text describes what is on the paper.
 */
export const DOCS_AFTER: StoryDocument[] = [
  {
    id: 'receipts_freistadt',
    kind: 'receipt',
    title: { de: 'Kassabons, mit einer Wäscheklammer zusammengehalten', en: 'Till receipts, held together with a clothes peg' },
    date: '1987-12/1999-10',
    author: 'Josef Hrubý',
    location: 'workshop',
    style: 'print',
    tags: ['receipts', 'sizes_growing', 'josef', 'freistadt_not_liebenau', 'niece'],
    de: `TEXTIL HAIDER · FREISTADT · Hauptplatz 8
12.12.87
Mädchen-Unterhemd Gr. 128   2 x 69,–    S 138,–
Strumpfhose Gr. 128                     S  59,–
Pullover Gr. 134 blau                   S 299,–
SUMME                                   S 496,–
[Bleistift:] warm

TEXTIL HAIDER · FREISTADT
04.10.89
Anorak Mädchen Gr. 140                  S 890,–
Hausschuhe Gr. 33                       S 159,–
SUMME                                 S 1.049,–

TEXTIL HAIDER · FREISTADT
21.09.92
Nachthemd Gr. 152           2 x 199,–   S 398,–
Pullover Gr. 152                        S 349,–
SUMME                                   S 747,–

DROGERIE MAYRHOFER · FREISTADT
07.05.93
Monatsbinden                2 Pkg.      S  78,–
Kinder-Shampoo                          S  39,–
Haarspangen                             S  24,–
SUMME                                   S 141,–
[Bleistift:] nicht in Liebenau

TEXTIL HAIDER · FREISTADT
03.11.95
Damen-Nachthemd Gr. 38                  S 289,–
Strickjacke Damen Gr. 38                S 590,–
SUMME                                   S 879,–
[Bleistift:] Die Verkäuferin fragt, für wen. Gesagt: Nichte.

TEXTIL HAIDER · FREISTADT
18.10.99
Damen-Pullover Gr. 40                   S 490,–
Wollsocken                  2 Paar      S 118,–
SUMME                                   S 608,–`,
    en: `TEXTIL HAIDER · FREISTADT · Hauptplatz 8
12/12/87
Girl's vest size 128        2 x 69.–    S 138.–
Tights size 128                         S  59.–
Jumper size 134 blue                    S 299.–
TOTAL                                   S 496.–
[Pencil:] warm

TEXTIL HAIDER · FREISTADT
04/10/89
Girl's anorak size 140                  S 890.–
Slippers size 33                        S 159.–
TOTAL                                 S 1,049.–

TEXTIL HAIDER · FREISTADT
21/09/92
Nightdress size 152         2 x 199.–   S 398.–
Jumper size 152                         S 349.–
TOTAL                                   S 747.–

DROGERIE MAYRHOFER · FREISTADT
07/05/93
Sanitary towels             2 packs     S  78.–
Children's shampoo                      S  39.–
Hair slides                             S  24.–
TOTAL                                   S 141.–
[Pencil:] not in Liebenau

TEXTIL HAIDER · FREISTADT
03/11/95
Women's nightdress size 38              S 289.–
Women's cardigan size 38                S 590.–
TOTAL                                   S 879.–
[Pencil:] The shop girl asks who it's for. Said: my niece.

TEXTIL HAIDER · FREISTADT
18/10/99
Women's jumper size 40                  S 490.–
Wool socks                  2 pairs     S 118.–
TOTAL                                   S 608.–`,
  },
  {
    id: 'receipt_schoolbooks_1989',
    kind: 'receipt',
    title: { de: 'Rechnung der Buch- und Papierhandlung', en: 'Bookshop and stationer\'s receipt' },
    date: '1989-09-04',
    author: 'Buch- und Papierhandlung Wiesinger',
    location: 'manor_basement_storage',
    style: 'print',
    tags: ['schoolbooks', 'lesebuch', 'third_grade', 'josef'],
    de: `BUCH- UND PAPIERHANDLUNG WIESINGER
Freistadt, Pfarrgasse 3
04.09.1989

1 Lesebuch 3. Schulstufe              S 118,–
1 Sprachbuch 3                        S 104,–
1 Rechenbuch 3                        S  96,–
5 Schreibhefte liniert   à 4,50       S  22,50
1 Buntstifte Jolly 24 Stk.            S  89,–
1 Radiergummi                         S   6,–
                         SUMME        S 435,50

Danke für Ihren Einkauf!

[Bleistift, auf der Rückseite:] Von vorn anfangen. Seite 1.`,
    en: `WIESINGER BOOKSHOP AND STATIONER'S
Freistadt, Pfarrgasse 3
04/09/1989

1 Reader, 3rd year                    S 118.–
1 Language book 3                     S 104.–
1 Arithmetic book 3                   S  96.–
5 exercise books, ruled  @ 4.50       S  22.50
1 Jolly coloured pencils, 24          S  89.–
1 eraser                              S   6.–
                         TOTAL        S 435.50

Thank you for your custom!

[Pencil, on the back:] Start from the beginning. Page 1.`,
  },
  {
    id: 'drawing_1995',
    kind: 'drawing',
    title: { de: 'Bleistiftzeichnung auf einem Kalenderblatt', en: 'Pencil drawing on a calendar page' },
    date: '1995-02',
    author: 'M.',
    location: 'manor_basement_sealed_room',
    style: 'handwriting_child',
    tags: ['drawing', 'marie_later', 'no_moon', 'man_with_hat', 'no_window'],
    de: `[Bleistift, auf der Rückseite eines Kalenderblattes „Mai 1994“.]
[Ein Zimmer ohne Fenster. Eine Glühbirne an einem Kabel, sehr genau gezeichnet, mit vielen kurzen Strahlen. Auf einem Bett sitzt ein großes Mädchen; die Arme und Beine sind zu lang und zu dünn geraten, die Hände sind nur Kreise. Neben dem Bett ein Mann mit Hut, er trägt einen Teller. Oben in der Ecke, wo Kinder sonst die Sonne malen, ist nichts. Kein Mond.]
[Unten, in großen Druckbuchstaben, das S verkehrt:] MARIE
[Auf der Rückseite, in sauberer Erwachsenenschrift:] M., Fasching 1995`,
    en: `[Pencil, on the back of a calendar page for "May 1994".]
[A room with no window. A light bulb hanging from a cable, drawn very carefully, with many short rays. A tall girl sits on a bed; her arms and legs have come out too long and too thin, the hands are just circles. Beside the bed a man with a hat, carrying a plate. Up in the corner, where children usually draw the sun, there is nothing. No moon.]
[At the bottom, in large block capitals:] MARIE
[On the back, in a neat adult hand:] M., Carnival 1995`,
  },
  {
    id: 'drawing_2001',
    kind: 'drawing',
    title: { de: 'Buntstiftzeichnung „Mondnacht“', en: 'Coloured-pencil drawing, "Moonlit night"' },
    date: '2001-09-30',
    author: 'M.',
    location: 'tunnel',
    style: 'handwriting_child',
    tags: ['drawing', 'marie_later', 'moon', 'trees_counted', 'woman_at_window', 'taller_than_man'],
    de: `[Buntstift und Wachsmalkreide auf Packpapier.]
[Das Gutshaus von außen, von unten gesehen, als läge der Zeichner im Gras. Die Fenster sind gezählt und alle dunkel bis auf eines im ersten Stock: dort steht eine Frau mit langen Haaren und einem roten Tuch. Darüber ein sehr großer gelber Mond, so oft nachgezogen, daß das Papier glänzt. Rechts der Waldrand: jeder Baum einzeln, mit einer Zahl daneben, 1 bis 40. Vor dem Wald ein Mann mit Hut, er hält ein Mädchen an der Hand. Das Mädchen ist größer als der Mann.]
[Auf der Rückseite, saubere, aber zittrige Schrift:] Mondnacht, Sept. 2001`,
    en: `[Coloured pencil and wax crayon on brown wrapping paper.]
[The manor seen from outside and from below, as if the artist were lying in the grass. The windows have been counted and are all dark except one on the first floor: a woman with long hair and a red headscarf stands in it. Above, a very large yellow moon, gone over so many times that the paper shines. On the right the edge of the forest: every tree drawn separately, with a number beside it, 1 to 40. In front of the forest a man with a hat holds a girl by the hand. The girl is taller than the man.]
[On the back, in a neat but shaky hand:] Moonlit night, Sept. 2001`,
  },
  {
    id: 'drawing_chapel_undated',
    kind: 'drawing',
    title: { de: 'Zeichnung auf einem Blatt aus einem Rechenheft', en: 'Drawing on a page from an arithmetic exercise book' },
    location: 'chapel',
    style: 'handwriting_child',
    tags: ['drawing', 'marie_later', 'josef_grave', 'hat', 'candles', 'undated'],
    de: `[Bleistift, auf einem karierten Blatt, herausgerissen aus einem Rechenheft. Auf der Rückseite noch Rechnungen: 7 x 8 = 56, 9 x 6 = 54, sorgfältig, ohne Fehler.]
[Eine Kapelle auf einem Hügel. Daneben, unter drei Bäumen, ein Hügel aus Erde mit einem Holzkreuz; über dem Kreuz hängt ein Hut. Neben dem Hügel steht ein Mädchen mit langen Haaren, allein. Sehr viele Kerzen, jede mit einem kleinen Strich als Flamme. Kein Datum.]
[Unten, in großen, ungelenken Buchstaben:] J. SCHLAFT`,
    en: `[Pencil, on a squared page torn from an arithmetic exercise book. On the back there are still sums: 7 x 8 = 56, 9 x 6 = 54, careful, no mistakes.]
[A chapel on a hill. Next to it, under three trees, a mound of earth with a wooden cross; a hat hangs on the cross. Beside the mound stands a girl with long hair, alone. A great many candles, each with a small stroke for a flame. No date.]
[At the bottom, in large, awkward letters:] J. SLEEPS [sic: "SCHLAFT"]`,
  },
  {
    id: 'parte_josef_2004',
    kind: 'parte',
    title: { de: 'Parte, nicht verschickt', en: 'Death notice, never sent' },
    date: '2004-01',
    author: 'Josef Hrubý (vorbereitet)',
    location: 'caretaker_bedroom',
    style: 'print',
    tags: ['josef', 'death', 'unsent', 'blank_mourners', 'family_cemetery'],
    de: `[Schwarzer Rand. Oben ein kleines Kreuz.]

Gott der Herr hat seinen Diener

Herrn
JOSEF HRUBÝ
Verwalter auf Gut Waldegg

geb. am 2. Februar 1931 in Nová Ves bei Krumau

am ________________ im ____. Lebensjahr
zu sich in die Ewigkeit abberufen.

Das Seelenamt wird in der Kapelle Waldegg gefeiert.
Die Beisetzung erfolgt im Familienfriedhof Waldegg.

„Der Herr ist mein Hirte, nichts wird mir fehlen.“

In stiller Trauer:
______________________________

Buchdruckerei Hölzl, Freistadt · Auftrag 2003/412

[In die Lücken mit Bleistift, große, runde Buchstaben:] JENNER 2004 · 73
[Die Zeile „In stiller Trauer“ ist leer. Das Kuvert ist nicht adressiert.]`,
    en: `[Black border. A small cross at the top.]

The Lord God has called His servant

Herr
JOSEF HRUBÝ
Steward of the Waldegg estate

born 2 February 1931 in Nová Ves near Krumau

home to eternity on ________________ in the ____ year of his life.

The requiem will be celebrated in the Waldegg chapel.
Burial will take place in the Waldegg family cemetery.

"The Lord is my shepherd; I shall not want."

Mourned in silence by:
______________________________

Hölzl printers, Freistadt · Order 2003/412

[Written into the gaps in pencil, large round letters:] JANUWARY 2004 · 73
[The line "Mourned in silence by" is empty. The envelope is not addressed.]`,
  },
  {
    id: 'mailbox_delivery_note_2017',
    kind: 'receipt',
    title: { de: 'Lieferschein des Lagerhauses', en: 'Co-op delivery note' },
    date: '2017-10-12',
    author: 'Lagerhaus Freistadt',
    location: 'road_mailbox',
    style: 'print',
    tags: ['diesel', 'generator', 'after_josef', 'order_by_letter', 'smoke'],
    de: `LAGERHAUS FREISTADT eGen
Lieferschein Nr. 17-08814                       Datum: 12.10.2017

Kunde: Hrubý J., Gut Waldegg 2, 4252 Liebenau

Art.-Nr. 1100  Diesel           200 l  à € 1,089      € 217,80
Zustellung Hof                                          € 0,00
Summe inkl. 20 % MwSt.                                € 217,80
Zahlung: bar

Fahrervermerk: Bestellung wie jedes Jahr per Brief, Bargeld beigelegt (€ 220,–). Niemand angetroffen. Tor offen, 10 Kanister im Stadl befüllt. Wechselgeld € 2,20 mit Lieferschein in den Postkasten. Rauch aus dem Kamin vom kleinen Haus.

Unterschrift Kunde: —`,
    en: `LAGERHAUS FREISTADT co-operative
Delivery note no. 17-08814                      Date: 12/10/2017

Customer: Hrubý J., Gut Waldegg 2, 4252 Liebenau

Item 1100  Diesel               200 l  @ € 1.089      € 217.80
Delivery to premises                                    € 0.00
Total incl. 20% VAT                                   € 217.80
Payment: cash

Driver's note: Ordered by letter as every year, cash enclosed (€ 220.–). Nobody there. Gate open, filled 10 cans in the barn. Change € 2.20 put in the mailbox with the delivery note. Smoke from the chimney of the small house.

Customer's signature: —`,
  },
  {
    id: 'greenhouse_seed_packet',
    kind: 'note',
    title: { de: 'Samenpackerl mit Notiz', en: 'Seed packet with a note' },
    location: 'greenhouse',
    style: 'handwriting_child',
    tags: ['marie_later', 'garden', 'recent', 'says_j'],
    de: `[Samenpackerl, Druck:] Paradeiser „Harzfeuer“ · abgepackt 2016
[Rückseite, Bleistift, große runde Schrift:]
PARADEISER ERST NACH DER KALTEN SOFIE (sagt J.)
Erdäpfel 3 Reihen
Bohnen an die Stangen
Gießen am Abend, nicht in der Sonne`,
    en: `[Seed packet, printed:] Tomato "Harzfeuer" · packed 2016
[On the back, pencil, large round handwriting:]
TOMATOES NOT TILL AFTER COLD SOFIE (says J.)
Potatoes 3 rows
Beans up the poles
Water in the evening, not in the sun`,
  },
  {
    id: 'calendar_2019_11',
    kind: 'calendar',
    title: { de: 'Pfarrkalender 2019, Blatt November', en: 'Parish calendar 2019, November page' },
    date: '2019-11',
    author: 'M.',
    location: 'caretaker_kitchen',
    style: 'handwriting_child',
    tags: ['calendar', 'recent', 'findetag', 'candles_for_j', 'diesel', 'car_at_gate'],
    de: `[Druck:] PFARRKALENDER 2019 · Pfarre Liebenau
NOVEMBER — [Bild: Allerseelen, Gräber mit roten Lichtern im Nebel]

[Alle Tage bis zum 30. sind mit einem sauberen X durchgestrichen. Dazwischen, in großer, runder Schrift:]

Fr 1   Allerheiligen — Kerzen Kapelle
Sa 2   Allerseelen — Kerzen J.
Mi 6   Diesel 2 Kanister. Noch 11.
Do 14  FINDETAG. 32. Gugelhupf, 1 Kerze.
Sa 16  Auto am Tor. Licht aus. Gewartet.
Mi 20  Erster Schnee.
Sa 30  Holz von hinten nach vorn.`,
    en: `[Printed:] PARISH CALENDAR 2019 · Liebenau parish
NOVEMBER — [Picture: All Souls, graves with red lights in the fog]

[Every day up to the 30th has been crossed through with a neat X. In between, in large round handwriting:]

Fri 1   All Saints — candles chapel
Sat 2   All Souls — candles J.
Wed 6   Diesel 2 cans. 11 left.
Thu 14  FINDING DAY. 32. Gugelhupf, 1 candle.
Sat 16  Car at the gate. Lights out. Waited.
Wed 20  First snow.
Sat 30  Wood from the back to the front.`,
  },
  {
    id: 'note_mama',
    kind: 'list',
    title: { de: 'Zettel: „Was ich von Mama weiß“', en: 'Note: "What I know about Mama"' },
    location: 'manor_basement_sealed_room',
    style: 'handwriting_child',
    tags: ['marie_later', 'mama', 'moon_song', 'stairs', 'old_spelling', 'undated'],
    de: `WAS ICH VON MAMA WEISS

Mama singt das Mondlied. Bis zum Nebel.
Mama hat kalte Hände und ein warmes Gesicht.
Mama riecht nach Nivea und nach Zwiebel.
Mama sagt Mausi zu mir.
Mama hat im Garten ein rotes Kopftuch.
Mama strickt rot.
Mama ist krank in Linz und kommt wieder, sagt J.
Mama hat auf der Stiege gesessen. Ich habe es gehört. Ich durfte nicht rufen.

Wenn Mama kommt, sage ich ihr, daß ich das Lesebuch kann.`,
    en: `WHAT I KNOW ABOUT MAMA

Mama sings the moon song. Up to the fog.
Mama has cold hands and a warm face.
Mama smells of Nivea and onions.
Mama calls me Mausi.
Mama wears a red headscarf in the garden.
Mama knits in red.
Mama is ill in Linz and will come back, J. says.
Mama sat on the stairs. I heard her. I was not allowed to call out.

When Mama comes I will tell her that I know the whole reader.`,
  },
];
