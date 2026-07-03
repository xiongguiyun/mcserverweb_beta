const VERSION = 6;
const SIZE = VERSION * 4 + 17;
const DATA_CODEWORDS = 108;
const BLOCK_COUNT = 4;
const ECC_PER_BLOCK = 16;
const TOTAL_CODEWORDS = 172;
const PAD_BYTES = [0xec, 0x11];
const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

const getBit = (value, bit) => ((value >>> bit) & 1) !== 0;

const appendBits = (buffer, value, length) => {
  for (let bit = length - 1; bit >= 0; bit--) buffer.push((value >>> bit) & 1);
};

const toUtf8 = (text) => Array.from(new TextEncoder().encode(text));

const reedSolomonMultiply = (x, y) => {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
};

const reedSolomonDivisor = (degree) => {
  const result = new Array(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = reedSolomonMultiply(root, 0x02);
  }
  return result;
};

const reedSolomonRemainder = (data, divisor) => {
  const result = divisor.map(() => 0);
  for (const value of data) {
    const factor = value ^ result.shift();
    result.push(0);
    divisor.forEach((coef, index) => {
      result[index] ^= reedSolomonMultiply(coef, factor);
    });
  }
  return result;
};

const makeCodewords = (text) => {
  const data = toUtf8(text);
  if (data.length > 106) throw new RangeError("2FA URI is too long for local QR renderer");
  const bits = [];
  appendBits(bits, 0x4, 4);
  appendBits(bits, data.length, 8);
  data.forEach((value) => appendBits(bits, value, 8));
  appendBits(bits, 0, Math.min(4, DATA_CODEWORDS * 8 - bits.length));
  appendBits(bits, 0, (8 - (bits.length % 8 || 8)) % 8);

  const dataCodewords = [];
  while (dataCodewords.length * 8 < bits.length) dataCodewords.push(0);
  bits.forEach((bit, index) => {
    dataCodewords[index >>> 3] |= bit << (7 - (index & 7));
  });
  for (let padIndex = 0; dataCodewords.length < DATA_CODEWORDS; padIndex++) {
    dataCodewords.push(PAD_BYTES[padIndex % PAD_BYTES.length]);
  }

  const divisor = reedSolomonDivisor(ECC_PER_BLOCK);
  const blocks = [];
  for (let i = 0; i < BLOCK_COUNT; i++) {
    const blockData = dataCodewords.slice(i * 27, (i + 1) * 27);
    const ecc = reedSolomonRemainder(blockData, divisor);
    blocks.push([...blockData, 0, ...ecc]);
  }

  const result = [];
  for (let i = 0; i < 44; i++) {
    blocks.forEach((block) => {
      if (i !== 27) result.push(block[i]);
    });
  }
  return result.slice(0, TOTAL_CODEWORDS);
};

const makeMatrix = () => new Array(SIZE).fill(null).map(() => new Array(SIZE).fill(false));
const makeFunctionMask = () => new Array(SIZE).fill(null).map(() => new Array(SIZE).fill(false));

const setFunctionModule = (modules, mask, x, y, isDark) => {
  modules[y][x] = isDark;
  mask[y][x] = true;
};

const drawFinder = (modules, mask, centerX, centerY) => {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = centerX + dx;
      const y = centerY + dy;
      if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFunctionModule(modules, mask, x, y, dist !== 2 && dist !== 4);
    }
  }
};

const drawAlignment = (modules, mask, centerX, centerY) => {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunctionModule(modules, mask, centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
};

const drawFormatBits = (modules, mask, pattern) => {
  const data = (0 << 3) | pattern;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) setFunctionModule(modules, mask, 8, i, getBit(bits, i));
  setFunctionModule(modules, mask, 8, 7, getBit(bits, 6));
  setFunctionModule(modules, mask, 8, 8, getBit(bits, 7));
  setFunctionModule(modules, mask, 7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) setFunctionModule(modules, mask, 14 - i, 8, getBit(bits, i));

  for (let i = 0; i < 8; i++) setFunctionModule(modules, mask, SIZE - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) setFunctionModule(modules, mask, 8, SIZE - 15 + i, getBit(bits, i));
  setFunctionModule(modules, mask, 8, SIZE - 8, true);
};

const drawFunctionPatterns = (modules, mask) => {
  for (let i = 0; i < SIZE; i++) {
    setFunctionModule(modules, mask, 6, i, i % 2 === 0);
    setFunctionModule(modules, mask, i, 6, i % 2 === 0);
  }
  drawFinder(modules, mask, 3, 3);
  drawFinder(modules, mask, SIZE - 4, 3);
  drawFinder(modules, mask, 3, SIZE - 4);
  drawAlignment(modules, mask, 34, 34);
  drawFormatBits(modules, mask, 0);
};

const drawCodewords = (modules, functionMask, data) => {
  let bitIndex = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < SIZE; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? SIZE - 1 - vert : vert;
        if (!functionMask[y][x] && bitIndex < data.length * 8) {
          modules[y][x] = getBit(data[bitIndex >>> 3], 7 - (bitIndex & 7));
          bitIndex++;
        }
      }
    }
  }
};

const maskPredicate = (mask, x, y) => {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    default: return false;
  }
};

const applyMask = (modules, functionMask, pattern) => {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!functionMask[y][x] && maskPredicate(pattern, x, y)) modules[y][x] = !modules[y][x];
    }
  }
};

const finderPenaltyCountPatterns = (history, size) => {
  const n = history[1];
  const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
  return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
};

const finderPenaltyAddHistory = (history, currentRun, size) => {
  if (history[0] === 0) currentRun += size;
  history.pop();
  history.unshift(currentRun);
};

const finderPenaltyTerminateAndCount = (history, currentRunColor, currentRun, size) => {
  if (currentRunColor) {
    finderPenaltyAddHistory(history, currentRun, size);
    currentRun = 0;
  }
  currentRun += size;
  finderPenaltyAddHistory(history, currentRun, size);
  return finderPenaltyCountPatterns(history, size);
};

const getPenaltyScore = (modules) => {
  let result = 0;
  for (let y = 0; y < SIZE; y++) {
    let runColor = false;
    let run = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let x = 0; x < SIZE; x++) {
      if (modules[y][x] === runColor) {
        run++;
        if (run === 5) result += PENALTY_N1;
        else if (run > 5) result++;
      } else {
        finderPenaltyAddHistory(history, run, SIZE);
        if (!runColor) result += finderPenaltyCountPatterns(history, SIZE) * PENALTY_N3;
        runColor = modules[y][x];
        run = 1;
      }
    }
    result += finderPenaltyTerminateAndCount(history, runColor, run, SIZE) * PENALTY_N3;
  }

  for (let x = 0; x < SIZE; x++) {
    let runColor = false;
    let run = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let y = 0; y < SIZE; y++) {
      if (modules[y][x] === runColor) {
        run++;
        if (run === 5) result += PENALTY_N1;
        else if (run > 5) result++;
      } else {
        finderPenaltyAddHistory(history, run, SIZE);
        if (!runColor) result += finderPenaltyCountPatterns(history, SIZE) * PENALTY_N3;
        runColor = modules[y][x];
        run = 1;
      }
    }
    result += finderPenaltyTerminateAndCount(history, runColor, run, SIZE) * PENALTY_N3;
  }

  for (let y = 0; y < SIZE - 1; y++) {
    for (let x = 0; x < SIZE - 1; x++) {
      const color = modules[y][x];
      if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) result += PENALTY_N2;
    }
  }

  let dark = 0;
  for (const row of modules) dark += row.reduce((sum, cell) => sum + (cell ? 1 : 0), 0);
  const total = SIZE * SIZE;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * PENALTY_N4;
  return result;
};

const cloneMatrix = (matrix) => matrix.map((row) => row.slice());

const chooseBestMask = (baseModules, functionMask) => {
  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestModules = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = cloneMatrix(baseModules);
    applyMask(candidate, functionMask, mask);
    drawFormatBits(candidate, functionMask, mask);
    const penalty = getPenaltyScore(candidate);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestModules = candidate;
    }
  }
  return { mask: bestMask, modules: bestModules };
};

export const renderQrSvg = (text, options = {}) => {
  const modules = makeMatrix();
  const functionMask = makeFunctionMask();
  drawFunctionPatterns(modules, functionMask);
  drawCodewords(modules, functionMask, makeCodewords(text));
  const best = chooseBestMask(modules, functionMask);
  const border = options.border ?? 2;
  const cellSize = options.cellSize ?? 4;
  const viewSize = (SIZE + border * 2) * cellSize;
  const rects = [];

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!best.modules[y][x]) continue;
      rects.push(`<rect x="${(x + border) * cellSize}" y="${(y + border) * cellSize}" width="${cellSize}" height="${cellSize}"/>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" role="img" aria-label="2FA 二维码"><rect width="${viewSize}" height="${viewSize}" fill="#fff"/> <g fill="#111">${rects.join("")}</g></svg>`;
};
