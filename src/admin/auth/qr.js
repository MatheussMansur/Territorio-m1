// Um pequeno gerador de QR code para o endereço do autenticador (otpauth://…): modo byte, nível
// de correção M, versões 1 a 10, a máscara com a menor penalidade. Basta para a tela de
// primeiro acesso mostrar um código que qualquer app autenticador lê, sem biblioteca.

// [palavras de dados por bloco, número de blocos] grupos e palavras de correção por bloco, nível M
const VERSIONS_M = [
  null,
  { ec: 10, groups: [[16, 1]] },
  { ec: 16, groups: [[28, 1]] },
  { ec: 26, groups: [[44, 1]] },
  { ec: 18, groups: [[32, 2]] },
  { ec: 24, groups: [[43, 2]] },
  { ec: 16, groups: [[27, 4]] },
  { ec: 18, groups: [[31, 4]] },
  { ec: 22, groups: [[38, 2], [39, 2]] },
  { ec: 22, groups: [[36, 3], [37, 2]] },
  { ec: 26, groups: [[43, 4], [44, 1]] },
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const dataCapacity = (v) => VERSIONS_M[v].groups.reduce((sum, [n, count]) => sum + n * count, 0);

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMul(coef, factor)));
  }
  return result;
}

/** As palavras de código de `bytes` na versão `v`, nível M, com a correção de erro intercalada. */
function codewords(bytes, v) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCapacity(v) * 8;
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  for (let pad = 0xec; data.length < dataCapacity(v); pad ^= 0xec ^ 0x11) data.push(pad);

  const { ec, groups } = VERSIONS_M[v];
  const divisor = rsDivisor(ec);
  const blocks = [];
  let k = 0;
  for (const [size, count] of groups) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(k, k + size);
      k += size;
      blocks.push({ data: block, ec: rsRemainder(block, divisor) });
    }
  }
  const out = [];
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function build(v, data, mask) {
  const size = v * 4 + 17;
  const grid = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    grid[y][x] = dark;
    fixed[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const align = ALIGN[v];
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  // bits de formato (nível M = 00) com o seu código BCH
  let rem = mask;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const format = ((mask << 10) | rem) ^ 0x5412;
  const bit = (value, i) => ((value >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(format, i));
  set(8, 7, bit(format, 6));
  set(8, 8, bit(format, 7));
  set(7, 8, bit(format, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(format, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(format, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(format, i));
  set(8, size - 8, true);

  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const info = (v << 12) | r;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(info, i));
      set(b, a, bit(info, i));
    }
  }

  // os dados, duas colunas por vez, em zigue-zague a partir do canto inferior direito
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fixed[y][x]) continue;
        const dark = i < data.length * 8 ? bit(data[i >>> 3], 7 - (i & 7)) : false;
        i++;
        grid[y][x] = dark !== MASKS[mask](x, y);
      }
    }
  }
  return grid;
}

/** Sequências de 5+ iguais, blocos 2×2 e o equilíbrio de escuros (a regra parecida com o localizador fica de fora). */
function penalty(grid) {
  const size = grid.length;
  let score = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const now = pass ? grid[b][a] : grid[a][b];
        const before = pass ? grid[b - 1][a] : grid[a][b - 1];
        if (now === before) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y][x]) dark++;
      if (x < size - 1 && y < size - 1 && grid[y][x] === grid[y][x + 1] && grid[y][x] === grid[y + 1][x] && grid[y][x] === grid[y + 1][x + 1]) score += 3;
    }
  }
  score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return score;
}

/** Os módulos do código para `text`: uma matriz quadrada de booleanos (true = escuro). */
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let v = 1;
  while (v <= 10 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataCapacity(v) * 8) v++;
  if (v > 10) throw new Error("QR: texto longo demais");
  const data = codewords(bytes, v);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const grid = build(v, data, mask);
    const score = penalty(grid);
    if (!best || score < best.score) best = { grid, score };
  }
  return best.grid;
}

/** Um path de SVG ("M x y h1 v1 h-1 z …") dos módulos escuros, com margem livre de 4 módulos. */
export function qrPath(text) {
  const grid = qrMatrix(text);
  const parts = [];
  grid.forEach((row, y) => row.forEach((dark, x) => dark && parts.push(`M${x + 4} ${y + 4}h1v1h-1z`)));
  return { size: grid.length + 8, d: parts.join("") };
}
