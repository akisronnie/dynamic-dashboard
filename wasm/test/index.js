import assert from "node:assert/strict";
import { it } from "node:test";
import { alloc, generateBatch, initProducer, memory } from "../build/debug.js";

const fieldsPerUpdate = 7;

function generate(updateCount, instrumentCount) {
  initProducer(instrumentCount);
  const output = alloc(updateCount * fieldsPerUpdate * Int32Array.BYTES_PER_ELEMENT);
  generateBatch(updateCount, output);
  return new Int32Array(memory.buffer, output, updateCount * fieldsPerUpdate);
}

it("writes exactly the requested number of updates", () => {
  for (const requested of [1, 17]) {
    const values = generate(requested, 3);
    assert.equal(values.length / fieldsPerUpdate, requested);
  }
});

it("generates valid market values for every requested update", () => {
  const instrumentCount = 4;
  const values = generate(200, instrumentCount);

  for (let index = 0; index < values.length; index += fieldsPerUpdate) {
    const [
      instrumentIndex,
      priceCents,
      tradeQuantity,
      bidCents,
      askCents,
      bidQuantity,
      askQuantity,
    ] = values.slice(index, index + fieldsPerUpdate);

    assert.ok(instrumentIndex >= 0 && instrumentIndex < instrumentCount);
    assert.ok(priceCents > 0);
    assert.ok(tradeQuantity >= 1 && tradeQuantity <= 100);
    assert.ok(bidCents > 0 && askCents > bidCents);
    assert.ok(priceCents === bidCents || priceCents === askCents);
    assert.ok(bidQuantity >= 1 && bidQuantity <= 1000);
    assert.ok(askQuantity >= 1 && askQuantity <= 1000);
  }
});
