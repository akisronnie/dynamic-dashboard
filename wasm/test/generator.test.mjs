
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const UPDATE_FIELDS = 7;

let wasm;

async function loadWasm() {
  const wasmBytes = await fs.readFile(
    new URL('../build/debug.wasm', import.meta.url),
  );

  const { instance } = await WebAssembly.instantiate(wasmBytes, {
    env: {
      abort: () => {
        throw new Error('WASM abort');
      },
    },
  });

  return instance.exports;
}

function allocateOutputBuffer(updateCount) {
  const size = updateCount * UPDATE_FIELDS * 4;

  return wasm.alloc(size);
}

function readBatch(ptr, updateCount) {
  const values = new Int32Array(
    wasm.memory.buffer,
    ptr,
    updateCount * UPDATE_FIELDS,
  );

  return Array.from({ length: updateCount }, (_, index) => {
    const offset = index * UPDATE_FIELDS;

    return {
      instrumentIndex: values[offset],
      tradePrice: values[offset + 1],
      tradeQuantity: values[offset + 2],
      bidCents: values[offset + 3],
      askCents: values[offset + 4],
      bidQuantity: values[offset + 5],
      askQuantity: values[offset + 6],
    };
  });
}

test.before(async () => {
  wasm = await loadWasm();
});

test('generates the requested number of updates', () => {
  const instrumentCount = 5;
  const updateCount = 100;

  wasm.initProducer(instrumentCount);

  const outputPtr = allocateOutputBuffer(updateCount);

  wasm.generateBatch(updateCount, outputPtr);

  const updates = readBatch(outputPtr, updateCount);

  assert.equal(updates.length, updateCount);
});

test('generates valid instrument indexes', () => {
  const instrumentCount = 5;
  const updateCount = 500;

  wasm.initProducer(instrumentCount);

  const outputPtr = allocateOutputBuffer(updateCount);

  wasm.generateBatch(updateCount, outputPtr);

  const updates = readBatch(outputPtr, updateCount);

  for (const update of updates) {
    assert.ok(
      update.instrumentIndex >= 0,
      `Instrument index must be >= 0, got ${update.instrumentIndex}`,
    );

    assert.ok(
      update.instrumentIndex < instrumentCount,
      `Instrument index must be < ${instrumentCount}, got ${update.instrumentIndex}`,
    );
  }
});

test('generates valid positive prices', () => {
  const instrumentCount = 5;
  const updateCount = 500;

  wasm.initProducer(instrumentCount);

  const outputPtr = allocateOutputBuffer(updateCount);

  wasm.generateBatch(updateCount, outputPtr);

  const updates = readBatch(outputPtr, updateCount);

  for (const update of updates) {
    assert.ok(
      update.tradePrice > 0,
      `Trade price must be positive, got ${update.tradePrice}`,
    );

    assert.ok(
      update.bidCents > 0,
      `Bid price must be positive, got ${update.bidCents}`,
    );

    assert.ok(
      update.askCents > 0,
      `Ask price must be positive, got ${update.askCents}`,
    );
  }
});

test('generates a valid bid-ask spread', () => {
  const instrumentCount = 5;
  const updateCount = 500;

  wasm.initProducer(instrumentCount);

  const outputPtr = allocateOutputBuffer(updateCount);

  wasm.generateBatch(updateCount, outputPtr);

  const updates = readBatch(outputPtr, updateCount);

  for (const update of updates) {
    assert.ok(
      update.bidCents < update.askCents,
      `Bid must be lower than ask: ${update.bidCents} >= ${update.askCents}`,
    );
  }
});

test('generates positive trade quantities', () => {
  const instrumentCount = 5;
  const updateCount = 500;

  wasm.initProducer(instrumentCount);

  const outputPtr = allocateOutputBuffer(updateCount);

  wasm.generateBatch(updateCount, outputPtr);

  const updates = readBatch(outputPtr, updateCount);

  for (const update of updates) {
    assert.ok(
      update.tradeQuantity > 0,
      `Trade quantity must be positive, got ${update.tradeQuantity}`,
    );
  }
});

test('generates non-negative order book quantities', () => {
  const instrumentCount = 5;
  const updateCount = 500;

  wasm.initProducer(instrumentCount);

  const outputPtr = allocateOutputBuffer(updateCount);

  wasm.generateBatch(updateCount, outputPtr);

  const updates = readBatch(outputPtr, updateCount);

  for (const update of updates) {
    assert.ok(
      update.bidQuantity >= 0,
      `Bid quantity must be non-negative, got ${update.bidQuantity}`,
    );

    assert.ok(
      update.askQuantity >= 0,
      `Ask quantity must be non-negative, got ${update.askQuantity}`,
    );
  }
});

test('generates trade price equal to bid or ask', () => {
  const instrumentCount = 5;
  const updateCount = 500;

  wasm.initProducer(instrumentCount);

  const outputPtr = allocateOutputBuffer(updateCount);

  wasm.generateBatch(updateCount, outputPtr);

  const updates = readBatch(outputPtr, updateCount);

  for (const update of updates) {
    assert.ok(
      update.tradePrice === update.bidCents ||
        update.tradePrice === update.askCents,
      `Trade price ${update.tradePrice} must equal bid ${update.bidCents} or ask ${update.askCents}`,
    );
  }
});

test('supports the maximum number of instruments', () => {
  const instrumentCount = 50;
  const updateCount = 1000;

  wasm.initProducer(instrumentCount);

  const outputPtr = allocateOutputBuffer(updateCount);

  wasm.generateBatch(updateCount, outputPtr);

  const updates = readBatch(outputPtr, updateCount);

  assert.equal(updates.length, updateCount);

  for (const update of updates) {
    assert.ok(
      update.instrumentIndex >= 0 &&
        update.instrumentIndex < instrumentCount,
      `Invalid instrument index: ${update.instrumentIndex}`,
    );
  }
});

test('preserves generator state between batches', () => {
  const instrumentCount = 5;
  const updateCount = 100;

  wasm.initProducer(instrumentCount);

  const outputPtr = allocateOutputBuffer(updateCount);

  wasm.generateBatch(updateCount, outputPtr);

  const firstBatch = readBatch(outputPtr, updateCount);

  wasm.generateBatch(updateCount, outputPtr);

  const secondBatch = readBatch(outputPtr, updateCount);

  assert.notDeepEqual(
    firstBatch,
    secondBatch,
    'Consecutive batches should contain different generated updates',
  );
});

test('generates updates for multiple instruments', () => {
  const instrumentCount = 5;
  const updateCount = 1000;

  wasm.initProducer(instrumentCount);

  const outputPtr = allocateOutputBuffer(updateCount);

  wasm.generateBatch(updateCount, outputPtr);

  const updates = readBatch(outputPtr, updateCount);

  const instruments = new Set(
    updates.map((update) => update.instrumentIndex),
  );

  assert.ok(
    instruments.size > 1,
    'Expected updates for more than one instrument',
  );
});

test('returns without generating when update count is zero', () => {
  const instrumentCount = 5;

  wasm.initProducer(instrumentCount);

  const outputPtr = allocateOutputBuffer(1);

  const memoryBefore = new Int32Array(
    wasm.memory.buffer,
    outputPtr,
    UPDATE_FIELDS,
  );

  memoryBefore.fill(12345);

  wasm.generateBatch(0, outputPtr);

  const memoryAfter = new Int32Array(
    wasm.memory.buffer,
    outputPtr,
    UPDATE_FIELDS,
  );

  assert.deepEqual(
    Array.from(memoryAfter),
    Array(UPDATE_FIELDS).fill(12345),
  );
});

test('returns without generating when producer is not initialized', async () => {
  const freshWasm = await loadWasm();

  const outputPtr = freshWasm.alloc(UPDATE_FIELDS * 4);

  const memoryBefore = new Int32Array(
    freshWasm.memory.buffer,
    outputPtr,
    UPDATE_FIELDS,
  );

  memoryBefore.fill(12345);

  freshWasm.generateBatch(1, outputPtr);

  const memoryAfter = new Int32Array(
    freshWasm.memory.buffer,
    outputPtr,
    UPDATE_FIELDS,
  );

  assert.deepEqual(
    Array.from(memoryAfter),
    Array(UPDATE_FIELDS).fill(12345),
  );
});
