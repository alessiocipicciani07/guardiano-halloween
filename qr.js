/*
 * Generatore di QR code (solo modalità byte, versioni 1-10, correzione errori selezionabile).
 * Implementazione compatta dell'algoritmo standard ISO/IEC 18004, senza dipendenze.
 *
 *   QR.matrix('HW26-ABC123')          -> array di righe con true = modulo scuro
 *   QR.draw(ctx, testo, x, y, lato)   -> disegna il QR in un canvas 2D
 *   QR.dataURL(testo, pxPerModulo)    -> PNG come data URL
 */
const QR = (() => {
  const ECL = { L: 0, M: 1, Q: 2, H: 3 };
  const FORMAT_BITS = [1, 0, 3, 2]; // L, M, Q, H
  const EC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
  ];
  const NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
  ];
  const MAX_VERSION = 10;

  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  function rawModules(ver) {
    let n = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const a = Math.floor(ver / 7) + 2;
      n -= (25 * a - 10) * a - 55;
      if (ver >= 7) n -= 36;
    }
    return n;
  }
  const dataCodewords = (ver, e) =>
    Math.floor(rawModules(ver) / 8) - EC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];

  function alignPositions(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const out = [6];
    for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  /* ---- Reed-Solomon su GF(256) ---- */
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    const out = new Array(degree).fill(0);
    out[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        out[j] = gfMul(out[j], root);
        if (j + 1 < degree) out[j] ^= out[j + 1];
      }
      root = gfMul(root, 2);
    }
    return out;
  }
  function rsRemainder(data, divisor) {
    const out = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ out.shift();
      out.push(0);
      divisor.forEach((c, i) => (out[i] ^= gfMul(c, factor)));
    }
    return out;
  }

  /* ---- costruzione dei dati ---- */
  function utf8(text) {
    return [...new TextEncoder().encode(text)];
  }

  function buildCodewords(bytes, ver, e) {
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(0b0100, 4);
    push(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(b => push(b, 8));
    const cap = dataCodewords(ver, e) * 8;
    push(0, Math.min(4, cap - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
    const data = new Array(bits.length / 8).fill(0);
    bits.forEach((b, i) => (data[i >>> 3] |= b << (7 - (i & 7))));
    return data;
  }

  function interleave(data, ver, e) {
    const nBlocks = NUM_BLOCKS[e][ver];
    const eccLen = EC_PER_BLOCK[e][ver];
    const raw = Math.floor(rawModules(ver) / 8);
    const nShort = nBlocks - (raw % nBlocks);
    const shortLen = Math.floor(raw / nBlocks);
    const div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const out = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((blk, j) => {
        if (i !== shortLen - eccLen || j >= nShort) out.push(blk[i]);
      });
    }
    return out;
  }

  /* ---- disegno della matrice ---- */
  function build(codewords, ver, e) {
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };

    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = alignPositions(ver);
    al.forEach((ax, i) => al.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));

    const formatBits = mask => {
      const data = (FORMAT_BITS[e] << 3) | mask;
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setFn(8, i, bit(bits, i));
      setFn(8, 7, bit(bits, 6)); setFn(8, 8, bit(bits, 7)); setFn(7, 8, bit(bits, 8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(bits, i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bits, i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bits, i));
      setFn(8, size - 8, true);
    };
    formatBits(0);
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + (i % 3), b = Math.floor(i / 3);
        setFn(a, b, bit(bits, i)); setFn(b, a, bit(bits, i));
      }
    }

    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x] && i < codewords.length * 8) {
          mod[y][x] = bit(codewords[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }

    const MASKS = [
      (x, y) => (x + y) % 2 === 0,
      (x, y) => y % 2 === 0,
      (x, y) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const applyMask = m => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
        if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x];
    };

    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); formatBits(m);
      const s = penalty(mod, size);
      if (s < bestScore) { best = m; bestScore = s; }
      applyMask(m); // annulla (XOR)
    }
    applyMask(best); formatBits(best);
    return mod;
  }

  function penalty(m, size) {
    let score = 0;
    for (let pass = 0; pass < 2; pass++) for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const cur = pass ? m[b][a] : m[a][b];
        const prev = pass ? m[b - 1][a] : m[a][b - 1];
        if (cur === prev) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1;
      }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
    const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let pass = 0; pass < 2; pass++) for (let a = 0; a < size; a++) for (let b = 0; b <= size - 11; b++) {
      let f1 = true, f2 = true;
      for (let k = 0; k < 11 && (f1 || f2); k++) {
        const v = (pass ? m[b + k][a] : m[a][b + k]) ? 1 : 0;
        if (v !== P1[k]) f1 = false;
        if (v !== P2[k]) f2 = false;
      }
      if (f1) score += 40;
      if (f2) score += 40;
    }
    let dark = 0;
    m.forEach(r => r.forEach(v => { if (v) dark++; }));
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }

  /* ---- API pubblica ---- */
  function matrix(text, level = 'M') {
    const e = ECL[level];
    const bytes = utf8(String(text));
    let ver = 1;
    while (ver <= MAX_VERSION) {
      const lenBits = ver < 10 ? 8 : 16;
      if (4 + lenBits + bytes.length * 8 <= dataCodewords(ver, e) * 8) break;
      ver++;
    }
    if (ver > MAX_VERSION) throw new RangeError('Testo troppo lungo per il QR code');
    return build(interleave(buildCodewords(bytes, ver, e), ver, e), ver, e);
  }

  /** Disegna il QR dentro il quadrato (x, y, lato) di un canvas 2D. */
  function draw(ctx, text, x, y, side, { dark = '#000', light = '#fff', margin = 4, level = 'M' } = {}) {
    const m = matrix(text, level);
    const n = m.length + margin * 2;
    const cell = Math.floor(side / n);
    const off = Math.floor((side - cell * n) / 2);
    ctx.fillStyle = light;
    ctx.fillRect(x, y, side, side);
    ctx.fillStyle = dark;
    m.forEach((row, r) => row.forEach((on, c) => {
      if (on) ctx.fillRect(x + off + (c + margin) * cell, y + off + (r + margin) * cell, cell, cell);
    }));
  }

  function dataURL(text, px = 8, opts) {
    const n = matrix(text, opts?.level).length + (opts?.margin ?? 4) * 2;
    const c = document.createElement('canvas');
    c.width = c.height = n * px;
    draw(c.getContext('2d'), text, 0, 0, c.width, opts);
    return c.toDataURL('image/png');
  }

  return { matrix, draw, dataURL };
})();

if (typeof module !== 'undefined') module.exports = QR;
