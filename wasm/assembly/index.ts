const MAX_INSTRUMENTS: i32 = 50;
const UPDATE_FIELDS: i32 = 7;

let seed: u32 = 123456789;

let instrumentCount: i32 = 0;

// Price is stored in cents.
let prices = new Int32Array(MAX_INSTRUMENTS);
const WASM_PAGE_SIZE: i32 = 65536;

export function alloc(size: i32): usize {
  const currentPages = memory.size();

  const pagesNeeded = <i32>Math.ceil(<f64>size / <f64>WASM_PAGE_SIZE);

  memory.grow(pagesNeeded);

  return <usize>currentPages * WASM_PAGE_SIZE;
}

// Random number in [0, 1).
function random(): f64 {
  seed = (seed * 1664525 + 1013904223) as u32;

  return <f64>seed / 4294967296.0;
}

function randomInt(min: i32, max: i32): i32 {
  return min + <i32>(random() * <f64>(max - min + 1));
}

function clampPositive(value: i32): i32 {
  return value > 1 ? value : 1;
}

/**
 * Initializes the producer and creates the initial price
 * for every instrument.
 */
export function initProducer(count: i32): void {
  instrumentCount = count;

  for (let i = 0; i < instrumentCount; i++) {
    // Initial prices between $50 and $150.
    prices[i] = randomInt(5000, 15000);
  }
}

/**
 * Generates a batch of market updates.
 *
 * Memory layout:
 *
 * [instrumentIndex,
 *  priceCents,
 *  tradeQuantity,
 *  bidCents,
 *  askCents,
 *  bidQuantity,
 *  askQuantity]
 *
 * repeated for every update.
 */
export function generateBatch(updateCount: i32, outputPtr: usize): void {
  if (instrumentCount <= 0 || updateCount <= 0) {
    return;
  }

  for (let i = 0; i < updateCount; i++) {
    const instrumentIndex = randomInt(0, instrumentCount - 1);

    const previousPrice = prices[instrumentIndex];

    // Price movement: -50 ... +50 cents.
    const change = randomInt(-50, 50);

    const newPrice = clampPositive(previousPrice + change);

    prices[instrumentIndex] = newPrice;

    // Spread: 1 ... 10 cents.
    const spread = randomInt(1, 10);

    const halfSpread = <i32>(spread / 2);

    let bidCents = newPrice - halfSpread;
    let askCents = bidCents + spread;

    bidCents = clampPositive(bidCents);
    askCents = bidCents + spread;

    const bidQuantity = randomInt(1, 1000);
    const askQuantity = randomInt(1, 1000);

    const tradeQuantity = randomInt(1, 100);

    // Trade happens either at bid or ask.
    const tradePrice = random() < 0.5 ? bidCents : askCents;

    const offset = i * UPDATE_FIELDS;

    store<i32>(outputPtr + <usize>offset * 4, instrumentIndex);

    store<i32>(outputPtr + <usize>(offset + 1) * 4, tradePrice);

    store<i32>(outputPtr + <usize>(offset + 2) * 4, tradeQuantity);

    store<i32>(outputPtr + <usize>(offset + 3) * 4, bidCents);

    store<i32>(outputPtr + <usize>(offset + 4) * 4, askCents);

    store<i32>(outputPtr + <usize>(offset + 5) * 4, bidQuantity);

    store<i32>(outputPtr + <usize>(offset + 6) * 4, askQuantity);
  }
}
