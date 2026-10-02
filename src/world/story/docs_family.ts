import type { StoryDocument } from './documents';

/** The Lindner family: Helga, Friedrich, Oma Resi, Marie (1987), a photo back. */
export const DOCS_FAMILY: StoryDocument[] = [
  {
    id: 'photo_back_1986',
    kind: 'photo_back',
    title: { de: 'Rückseite eines Fotos', en: 'Back of a photograph' },
    date: '1986-05-18',
    author: 'Helga Lindner',
    location: 'manor_thomas_room',
    style: 'handwriting_neat',
    tags: ['family', 'cast', 'helga'],
    de: `Waldegg, Pfingsten 1986
hinten: Josef, Oma Resi, Fritz
vorne: Thomas (mit dem neuen Rad), ich mit Marie
Fotografiert hat der Herr Pfarrer.`,
    en: `Waldegg, Whitsun 1986
back: Josef, Oma Resi, Fritz
front: Thomas (with the new bike), me with Marie
Taken by the parish priest.`,
  },
  {
    id: 'marie_school_1987',
    kind: 'note',
    title: { de: 'Hausübung: „Mein Zuhause“', en: 'Homework: "My Home"' },
    date: '1987-10-21',
    author: 'Marie Lindner',
    location: 'manor_marie_room',
    style: 'handwriting_child',
    tags: ['marie', 'child', 'moon_song', 'josef', 'rabbit', 'cellar_irony', 'drawing_style_reference'],
    de: `Hausübung          Mittwoch, 21. Oktober 1987
Aufsatz: Mein Zuhause

Ich heise Marie Lindner und bin 8 Jahre alt. Ich wone in Waldegg. Unser Haus ist sehr groß und hat 31 Fenster ich habe sie gezelt. Im Keller ist es finster da geh ich nicht hin. Der Josef wont im kleinen Haus beim Tor. Er kann alles reparieren. Er hat mir einen Hasen geschnitzt der heist Stupsi wie mein echter Hase. Mein Bruder Thomas ist schon groß und geht in Freistadt in die Schule. Die Oma betet fiel. Die Mama singt mir das Mondlied vor. Der Papa ist oft müde. Hinter dem Garten ist der Wald und ein Bach. Da darf ich nicht allein hin.

[Darunter, mit Buntstift: das große Haus mit vielen Fenstern, daneben ein kleines Haus. Ein Mann mit Hut, neben ihm ein Hase. Darüber ein gelber Mond mit Gesicht, obwohl auch die Sonne scheint.]

[Rote Tinte:] Sehr schön, Marie! Achte auf: heiße, wohne, gezählt, viel.  Fl.`,
    en: `Homework          Wednesday, 21 October 1987
Composition: My Home

My naim is Marie Lindner and I am 8 years old. I liv in Waldegg. Our house is very big and has 31 windows I cownted them. In the cellar it is dark so I dont go there. Josef lives in the litle house by the gate. He can fix everything. He carved me a rabbit called Stupsi like my real rabbit. My brother Thomas is big already and goes to school in Freistadt. Oma prays a lot. Mama sings me the moon song. Papa is often tired. Behind the garden is the forest and a stream. I am not allowed to go there alone.

[Below, in coloured pencil: the big house with many windows, a small house beside it. A man with a hat, a rabbit next to him. Above it all a yellow moon with a face, although the sun is shining too.]

[Red ink:] Very nice, Marie! Watch: name, live, counted, little.  Fl.`,
  },
  {
    id: 'oma_prayer_card_1988',
    kind: 'note',
    title: { de: 'Andachtsbild des hl. Antonius', en: 'Prayer card of St Anthony' },
    date: '1988-01',
    author: 'Theresia Lindner',
    location: 'manor_oma_room',
    style: 'handwriting_shaky',
    tags: ['oma', 'prayer', 'josef_says_she_hears'],
    de: `[Vorderseite, Druck:] Hl. Antonius von Padua — bitte für uns.

[Rückseite, mit Tinte:]
Heiliger Antonius, Du findest alles, was verloren ist.
Gib uns die Marie zurück.
Jeden Abend ein Vaterunser und drei Gegrüßet seist du, Maria.
Der Josef sagt, ich soll nicht aufhören. Er sagt, sie hört es.
Jänner 1988 — Th. L.`,
    en: `[Front, printed:] St Anthony of Padua — pray for us.

[Back, in ink:]
St Anthony, you find everything that is lost.
Give us our Marie back.
Every evening an Our Father and three Hail Marys.
Josef says I must not stop. He says she hears it.
January 1988 — Th. L.`,
  },
  {
    id: 'friedrich_note_1989',
    kind: 'note',
    title: { de: 'Zettel von Friedrich', en: 'Note from Friedrich' },
    date: '1989-10-03',
    author: 'Friedrich Lindner',
    location: 'manor_hall',
    style: 'handwriting_shaky',
    tags: ['friedrich', 'debts', 'leaves', 'blame'],
    de: `3.10.89

Helga,

ich fahr. Ruf nicht beim Rudi an, ich bin nicht dort.
Die Bank, die Säge, das Dach, die Steuer — ein Loch ohne Boden. Mein Großvater hat es aufgebaut, mein Vater hat es angebraucht, und den Rest gibst Du mir. Du schaust mich an, als hätte ich sie in den Wald geschickt. Ich war in Freistadt. Das weiß jeder. Frag den Josef, der weiß ja immer alles und sagt nie was.
Der Thomas bleibt im Internat. Das Schulgeld zahl ich, solang ich kann.
Der Schlüssel vom Safe liegt in der Lade. Es ist nichts mehr drin.

F.`,
    en: `3 Oct 89

Helga,

I'm going. Don't ring Rudi, I'm not there.
The bank, the sawmill, the roof, the taxes — a hole with no bottom. My grandfather built it up, my father ate into it, and you hand me the rest. You look at me as if I'd sent her into the forest. I was in Freistadt. Everybody knows that. Ask Josef, he always knows everything and never says a word.
Thomas stays at boarding school. I'll pay the fees as long as I can.
The key to the safe is in the drawer. There's nothing left in it.

F.`,
  },
  {
    id: 'helga_to_gerti_1989',
    kind: 'letter',
    title: { de: 'Brief an Gerti', en: 'Letter to Gerti' },
    date: '1989-12-10',
    author: 'Helga Lindner',
    location: 'manor_dining',
    style: 'handwriting_neat',
    tags: ['helga', 'sister', 'friedrich_violent', 'humming', 'josef_kind'],
    de: `Waldegg, am 10. Dezember 1989

Liebe Gerti!

Danke für das Packerl. Die Vanillekipferl waren alle zerbrochen, ich habe sie trotzdem gegessen, auf einmal, in der Speis, wie früher als Kinder.

Du fragst, wie es geht. Der Fritz ist seit Oktober in Wien. Er schreibt nicht, er ruft nur an, wenn er eine Unterschrift braucht. Ich will Dich nicht anlügen: es ist ruhiger, seit er weg ist. Du weißt, daß ihm früher manchmal die Hand ausgekommen ist. Seit dem November damals war es jeden Abend. Ich sag das nur Dir.

Der Thomas kommt zu Weihnachten nicht, er bleibt bei einem Schulfreund in Linz. Ich verstehe ihn. Hier schaut ihn alles an.

Der Josef ist gut zu mir. Er bringt Holz, er richtet alles, er fragt nichts. Manchmal stellt er mir eine Suppe vor die Tür, wie einer Katze.

Gerti, ich muß Dir noch etwas schreiben, und Du darfst nicht lachen. In der Nacht höre ich manchmal ein Summen. Ganz leise, von unten. So wie die Marie gesummt hat, wenn sie nicht einschlafen konnte, das Mondlied, immer nur den Anfang. Der Dr. Wallner sagt, das ist der Kummer, und ich soll die Tabletten nehmen. Ich nehme sie.

Komm im Frühjahr, wenn die Straße wieder geht. Bring die Kinder bitte nicht mit, das halte ich nicht aus.

Deine Helga`,
    en: `Waldegg, 10 December 1989

Dear Gerti,

Thank you for the parcel. The vanilla crescents were all broken, I ate them anyway, all at once, in the pantry, like when we were children.

You ask how things are. Fritz has been in Vienna since October. He doesn't write, he only rings when he needs a signature. I won't lie to you: it is quieter since he left. You know his hand used to slip now and then. After that November it was every evening. I'm only telling you.

Thomas isn't coming for Christmas, he's staying with a school friend in Linz. I understand him. Everything here looks at him.

Josef is good to me. He brings wood, he mends things, he asks nothing. Sometimes he leaves a bowl of soup outside my door, the way you would for a cat.

Gerti, there is something else I have to write, and you mustn't laugh. At night I sometimes hear humming. Very quiet, from below. The way Marie used to hum when she couldn't get to sleep, the moon song, only ever the beginning. Dr. Wallner says it is grief and I should take the tablets. I take them.

Come in the spring, when the road is passable again. Please don't bring the children, I couldn't bear it.

Your Helga`,
  },
  {
    id: 'helga_to_fritz_1990',
    kind: 'letter',
    title: { de: 'Brief an Fritz (nicht abgeschickt)', en: 'Letter to Fritz (never sent)' },
    date: '1990-02-18',
    author: 'Helga Lindner',
    location: 'manor_master_bedroom',
    style: 'handwriting_neat',
    tags: ['helga', 'friedrich', 'unsent', 'height_mark', 'missing_sweaters', 'coal_cellar', 'marten'],
    de: `Waldegg, 18. Feber 1990

Fritz,

ich schreibe Dir, obwohl Du nicht antwortest. Die Bank war wieder da, zwei Herren. Sie haben das Silber aufgeschrieben und die Bilder im Salon. Ich habe ihnen Kaffee gemacht. Was soll ich sonst tun.

Ich muß Dir etwas sagen, und ich bitte Dich, lies es bis zum Ende, bevor Du das Papier wegwirfst.

Am Türstock in der Küche, wo wir die Kinder gemessen haben, ist ein neuer Strich. Über dem von der Marie vom März 87. Mit Bleistift, nicht mit Deinem Kugelschreiber, und daneben steht „M 1988“. Ich habe ihn nicht gemacht. Der Thomas war seit dem Sommer nicht da. Ich habe es dem Dr. Wallner erzählt, und er hat mich ganz freundlich gefragt, ob ich mich erinnern kann, wann ich ihn gemacht habe.

Im Kasten im Gang fehlen zwei Pullover von ihr, der grüne und der mit den Hirschen. Ich habe dreimal gezählt.

Und ich höre sie. Nicht im Traum, Fritz, ich bin wach, ich sitze auf der Stiege. Es kommt von unten, von hinten, wo der alte Kohlenkeller ist. Der Josef sagt, es ist ein Marder. Er hat Fallen aufgestellt. Es ist nie einer drin.

Ich weiß, was Du denkst. Ich weiß, was alle denken. Ich verlange nicht, daß Du mir glaubst. Ich verlange nur, daß Du einmal herkommst und eine Nacht mit mir auf der Stiege sitzt. Eine Nacht. Nüchtern.

Helga`,
    en: `Waldegg, 18 February 1990

Fritz,

I am writing to you although you don't answer. The bank came again, two gentlemen. They made a list of the silver and the paintings in the drawing room. I made them coffee. What else am I supposed to do.

I have to tell you something, and I'm asking you to read it to the end before you throw the paper away.

On the kitchen door frame, where we measured the children, there is a new line. Above Marie's from March 87. In pencil, not with your ballpoint, and next to it it says "M 1988". I didn't make it. Thomas hasn't been here since the summer. I told Dr. Wallner, and he asked me, very kindly, whether I could remember when I had made it.

Two of her jumpers are missing from the wardrobe in the corridor, the green one and the one with the stags. I counted three times.

And I hear her. Not in a dream, Fritz, I'm awake, I'm sitting on the stairs. It comes from below, from the back, where the old coal cellar is. Josef says it's a marten. He's set traps. There's never anything in them.

I know what you think. I know what everyone thinks. I'm not asking you to believe me. I'm only asking you to come here once and sit on the stairs with me for one night. One night. Sober.

Helga`,
  },
  {
    id: 'helga_note_1991',
    kind: 'note',
    title: { de: 'Zettel aus Maries Zimmer', en: "Note from Marie's room" },
    date: '1991-03-03',
    author: 'Helga Lindner',
    location: 'manor_marie_room',
    style: 'handwriting_shaky',
    tags: ['helga', 'heard_her', 'moon_song'],
    de: `3. März 1991
2 Uhr 40

Unter der Küche. Oder weiter hinten.
Nicht weinen. Summen.
Das Mondlied, bis „und aus den Wiesen steiget“. Dann hört es auf. Dann wieder von vorn.

Ich habe sie wieder gehört.
Ich habe es niemandem gesagt.
Ich habe sie wieder gehört.`,
    en: `3 March 1991
2:40 a.m.

Under the kitchen. Or further back.
Not crying. Humming.
The moon song, up to "and from the meadows rising". Then it stops. Then from the start again.

I heard her again.
I haven't told anyone.
I heard her again.`,
  },
];
