'use strict';
/* Lettura dei bonifici dagli screenshot dell'app della banca.
   Qui c'è solo l'interpretazione del testo che l'OCR ha riconosciuto: nessun dato di persone, nessun accesso al
   browser. Funziona anche in Node (per i test). Il testo arriva dall'OCR e può contenere piccoli errori. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Bonifico = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const key = s => fold(s).replace(/['’]/g, ''); // «NICCOLO'» = «Niccolò»

  function lev(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }

  /* Nomi di battesimo comuni (senza accenti): servono solo a capire se in «ROSSI MARIO» il nome è il secondo.
     L'app aggiunge anche i nomi già presenti nella sua lista. */
  const FIRST_NAMES = new Set(`
    adele adriana adriano agnese agostino alberto alessandra alessandro alessia alessio alex alice alina amedeo amelia andrea angela angelica angelo anna annalisa antonella antonio arianna aurora azzurra
    barbara beatrice benedetta bianca brando bruno camilla carla carlo carlotta carolina caterina cecilia cesare chiara christian claudia claudio cristian cristiana cristina
    damiano daniel daniela daniele dario davide debora denis denise diego dino domenico donatella edoardo elena eleonora elia elisa elisabetta emanuele emma enrico enzo erica ettore eva
    fabio fabrizio federica federico filippo flavia flavio francesca francesco gabriele gabriella gaia giacomo giada gianluca gianmarco gianni gino gioele giorgia giorgio giovanna giovanni giulia giulio giuseppe giusy greta guido
    ilaria ilenia irene iris isabella ivan jacopo jessica kevin laura leonardo letizia lia linda lisa livia lorenzo luca lucia luciano ludovica luigi luisa manuel manuela marco margherita maria marina mario marta martina massimo matilde matteo mattia maurizio melissa michela michele milena mirco miriam monica nadia nicholas nicola nicolas nicole niccolo nicolo noemi olivia omar oscar paola paolo patrizia pietro rachele raffaele rebecca renato riccardo roberta roberto rosa rosalba sabrina salvatore samuel samuele sandro sara sebastiano serena sergio silvia simona simone sofia stefania stefano stella susanna tania teresa thomas tiziana tommaso valentina valerio valeria vanessa veronica viola virginia vittoria vittorio xavier yuri zoe
    iulian ionut mihai andrei marius alin florin catalin ahmed mohamed omar youssef ali
  `.split(/\s+/).filter(Boolean));

  /* Parole che stanno nella causale ma non sono un nome. */
  const STOP = new Set(`
    halloween hallowen halloween festa quota soldi soldo per la il lo di del della dei x pagamento pago pagato pagata biglietto biglietti ingresso party serata evento ottobre ott ticket bonifico saldo cash euro eur e a ed da con grazie ciao notprovided ore quanto ancora anche piu mio mia
  `.split(/\s+/).filter(Boolean));
  const isStop = w => {
    const f = fold(w);
    return STOP.has(f) || (f.length >= 6 && f.length <= 11 && f[0] === 'h' && lev(f, 'halloween') <= 3); // «hallowen», «halloweeen»…
  };

  const ACCENT = { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù' };
  const ACCENTED = { niccolo: 'Niccolò', nicolo: 'Nicolò', mose: 'Mosè', noe: 'Noè', giosue: 'Giosuè', andre: 'André' }; // la banca spesso toglie l'accento
  /* «NICCOLO'» → «Niccolò», «DE BENEDITTIS» → «De Benedittis» */
  function titleCase(s) {
    return String(s).toLowerCase()
      .replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
      .replace(/([aeiou])['’](?=\s|$)/g, (m, v) => ACCENT[v])
      .replace(/(^|\s)(\p{L}+)(?=\s|$)/gu, (m, a, w) => a + (ACCENTED[fold(w)] || w));
  }

  const words = s => String(s ?? '').replace(/[^\p{L}'’ ]+/gu, ' ').split(/\s+/).map(w => w.replace(/^['’]+/, '')).filter(Boolean);

  /* ---------- lettura del testo del bonifico ---------- */
  function parse(raw) {
    const flat = String(raw ?? '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
    const out = { amount: null, date: '', time: '', instant: /istantane/i.test(flat), pending: /in corso/i.test(flat), txn: '', sender: '', causale: '' };
    let m;

    const from = flat.search(/ricevut/i);
    const re = /(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(?!\d)/g;
    re.lastIndex = Math.max(from, 0);
    if ((m = re.exec(flat))) out.amount = Number(m[1].replace(/\./g, '') + '.' + m[2]);

    if ((m = /(?:ricevuto:?|COD\.?\s*DISP\.?:?)\s*(\d{10,})/i.exec(flat))) out.txn = m[1];

    if ((m = /MITT\.?\s*:?\s*(.+?)\s+BENEF/i.exec(flat))) out.sender = m[1];
    else if ((m = /ricevuto:?\s*\d+\s*disposto da\s+(.+?)\s+in data/i.exec(flat))) out.sender = m[1];
    else if ((m = /disposto da:?\s*(.+?)(?:\s+Beneficiario|\s+COD\.?\s*DISP|$)/i.exec(flat))) out.sender = m[1];
    out.sender = out.sender.replace(/\b(OGGI|IERI|IN CORSO)\b/gi, ' ').replace(/[^\p{L}'’ .]+/gu, ' ').replace(/\s+/g, ' ').trim();
    if (out.sender.length < 3) out.sender = '';

    let c = '';
    if ((m = /\bCausale\s+(.+?)\s+Data contabile/i.exec(flat))) c = m[1];
    else if ((m = /NOTPROVIDED\s*(.*?)\s*Bonifico a Vostro favore/i.exec(flat))) c = m[1];
    else if ((m = /\bCausale\s+(.{1,80})$/i.exec(flat))) c = m[1];
    out.causale = c.replace(/\s+/g, ' ').trim();

    if ((m = /Data contabile\s*(\d{2})[./-](\d{2})[./-](\d{4})/i.exec(flat))) out.date = `${m[3]}-${m[2]}-${m[1]}`;
    else if ((m = /in data\s+(\d{4})\D+(\d{2})\D+(\d{2})\s+alle\s+ore\s*(\d{1,2})\D(\d{2})/i.exec(flat))) {
      out.date = `${m[1]}-${m[2]}-${m[3]}`;
      out.time = `${m[4].padStart(2, '0')}:${m[5]}`;
    }
    out.ok = out.amount != null && !!out.sender;
    return out;
  }

  /* ---------- quale nome mettere in lista ---------- */
  function orderTokens(t, F) {
    const isF = w => F.has(key(w));
    if (t.length < 2) return { tokens: t, sure: false };
    const first = isF(t[0]), last = isF(t[t.length - 1]);
    if (first && !last) return { tokens: t, sure: true };
    if (!first && last) return { tokens: [t[t.length - 1], ...t.slice(0, -1)], sure: true }; // «Rossi Mario» → «Mario Rossi»
    if (t.length >= 3 && !first && isF(t[1])) return { tokens: [...t.slice(1), t[0]], sure: false }; // «Miron Denis Iulian» → «Denis Iulian Miron»
    return { tokens: t, sure: false };
  }

  const sameSet = (a, b) => {
    const A = new Set(a.map(key)), B = new Set(b.map(key));
    const sub = (x, y) => [...x].every(w => y.has(w));
    return A.size > 0 && B.size > 0 && (sub(A, B) || sub(B, A));
  };

  /* p = risultato di parse(); extraFirstNames = nomi di battesimo già noti all'app (Set, senza accenti). */
  function suggestName(p, extraFirstNames) {
    const F = new Set([...FIRST_NAMES, ...(extraFirstNames || [])]);
    const sender = orderTokens(words(p.sender), F);
    const cTokens = words(p.causale).filter(w => !isStop(w) && w.length >= 2);
    const cOk = cTokens.length >= 1 && cTokens.length <= 4;
    const cName = cOk ? orderTokens(cTokens, F) : null;
    const res = { name: '', paidBy: '', basis: '', uncertain: false, note: '' };

    if (cName && sameSet(cName.tokens, sender.tokens)) {
      // la causale e chi paga sono la stessa persona: si tiene la versione più completa
      const best = cName.tokens.length >= sender.tokens.length ? cName : sender;
      const ord = orderTokens(best.tokens, F);
      res.name = titleCase(ord.tokens.join(' '));
      res.basis = 'causale';
      res.uncertain = !(ord.sure || cName.sure || sender.sure) && ord.tokens.length > 1;
    } else if (cName) {
      // la causale nomina un'altra persona: ha pagato qualcuno per lei/lui
      res.name = titleCase(cName.tokens.join(' '));
      res.paidBy = titleCase(sender.tokens.join(' '));
      res.basis = 'causale';
      res.uncertain = !cName.sure;
      if (cName.tokens.length < 2) { res.uncertain = true; res.note = 'nella causale c’è solo il nome: aggiungi il cognome'; }
    } else {
      res.name = titleCase(sender.tokens.join(' '));
      res.basis = 'ordinante';
      res.uncertain = !sender.sure;
    }
    return res;
  }

  const refs = (p, name) => {
    const k = s => fold(s).replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' ');
    return [
      p.txn ? `txn:${p.txn}` : '',
      `sig:${k(p.sender)}|${p.amount}|${p.date}|${k(p.causale)}|${k(name)}`,
    ].filter(Boolean);
  };

  return { parse, suggestName, titleCase, orderTokens, refs, lev, fold, FIRST_NAMES };
});
