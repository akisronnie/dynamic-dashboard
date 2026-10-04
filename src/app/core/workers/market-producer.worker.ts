import { ProducerCommand, ProducerMessage, StartCommand } from '../models/producer-message.model';

const UPDATE_FIELDS = 7;
const BYTES_PER_FIELD = 4;
const INSTRUMENT_NAMES = ['ALFA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON'] as const;

type WasmExports = {
  memory: WebAssembly.Memory;
  initProducer: (instrumentCount: number) => void;
  generateBatch: (updateCount: number, outputPtr: number) => void;
  alloc: (size: number) => number;
};

let currentRunId = 0;

/**
 * Changes every time a new producer initialization starts or
 * the current producer is stopped.
 *
 * It protects against stale async initWasm() completions.
 */
let initializationGeneration = 0;

let paused = false;

let wasm: WasmExports | undefined;

let outputPtr = 0;
let outputCapacity = 0;

let timer: ReturnType<typeof setInterval> | undefined;

self.onmessage = (event: MessageEvent<ProducerCommand>) => {
  const command = event.data;

  switch (command.type) {
    case 'start':
      void start(command);
      break;

    case 'pause':
      pause(command.runId);
      break;

    case 'resume':
      resume(command.runId);
      break;
   }
};

async function start(command: StartCommand): Promise<void> {
  stopTimer();

  // Invalidate every previous asynchronous initialization.
  const generation = ++initializationGeneration;

  currentRunId = command.runId;

  resetProducerState();

  try {
    const wasmInstance = await initWasm();

    // Another start/stop happened while WASM was loading.
    if (generation !== initializationGeneration) {
      return;
    }

    wasm = wasmInstance;

    const requiredBytes = command.updatesPerBatch * UPDATE_FIELDS * BYTES_PER_FIELD;

    outputCapacity = requiredBytes;
    outputPtr = wasm.alloc(requiredBytes);

    if (generation !== initializationGeneration) return;

    wasm.initProducer(command.instrumentCount);

    if (generation !== initializationGeneration) {
      return;
    }

    postMessage({
      type: 'ready',
      runId: command.runId,
    } satisfies ProducerMessage);

    timer = setInterval(() => {
      if (generation !== initializationGeneration) {
        return;
      }

      if (paused) {
        return;
      }

      if (command.runId !== currentRunId) {
        return;
      }

      generateBatch(command.updatesPerBatch, command.runId, generation);
    }, command.batchInterval);
  } catch (error) {
    // Ignore errors from obsolete runs.
    if (generation !== initializationGeneration) {
      return;
    }

    postMessage({
      type: 'error',
      runId: command.runId,
      message: error instanceof Error ? error.message : 'Failed to initialize market producer',
    } satisfies ProducerMessage);
  }
}

function pause(runId: number): void {
  if (runId !== currentRunId) {
    return;
  }

  if (paused) {
    return;
  }

  paused = true;

  postMessage({
    type: 'paused',
    runId,
  } satisfies ProducerMessage);
}

function resume(runId: number): void {
  if (runId !== currentRunId) {
    return;
  }

  if (!paused) {
    return;
  }

  paused = false;

  postMessage({
    type: 'resumed',
    runId,
  } satisfies ProducerMessage);
}

// function stop(runId: number): void {
//   if (runId !== currentRunId) {
//     return;
//   }
//
//   // Invalidate any pending initWasm() operation.
//   initializationGeneration++;
//
//   stopTimer();
//
//   currentRunId = 0;
//
//   resetProducerState();
// }

function resetProducerState(): void {
  wasm = undefined;
  outputPtr = 0;
  outputCapacity = 0;
  paused = false;
}

function stopTimer(): void {
  if (timer === undefined) {
    return;
  }

  clearInterval(timer);
  timer = undefined;
}

async function initWasm(): Promise<WasmExports> {
  const response = await fetch('/wasm/release.wasm');

  if (!response.ok) {
    throw new Error(`Failed to load WASM: ${response.status} ${response.statusText}`);
  }

  const bytes = await response.arrayBuffer();

  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      abort(): never {
        throw new Error('WASM abort');
      },
    },
  });

  return instance.exports as unknown as WasmExports;
}

function generateBatch(updateCount: number, runId: number, generation: number): void {
  if (!wasm) {
    return;
  }

  // Protect against stale timer callbacks.
  if (generation !== initializationGeneration) {
    return;
  }

  if (runId !== currentRunId) {
    return;
  }

  wasm.generateBatch(updateCount, outputPtr);

  // The WASM call itself is synchronous, but keep the checks here
  // so stale data can never be published if the lifecycle changes.
  if (generation !== initializationGeneration) {
    return;
  }

  if (runId !== currentRunId) {
    return;
  }

  const values = new Int32Array(wasm.memory.buffer, outputPtr, updateCount * UPDATE_FIELDS);

  const updates = [];

  for (let i = 0; i < updateCount; i++) {
    const offset = i * UPDATE_FIELDS;

    updates.push({
      instrument: getInstrumentName(values[offset]),
      priceCents: values[offset + 1],
      tradeQuantity: values[offset + 2],
      bidCents: values[offset + 3],
      askCents: values[offset + 4],
      bidQuantity: values[offset + 5],
      askQuantity: values[offset + 6],
    });
  }

  if (generation !== initializationGeneration) {
    return;
  }

  if (runId !== currentRunId) {
    return;
  }

  postMessage({
    type: 'batch',
    runId,
    updates,
  } satisfies ProducerMessage);
}

function getInstrumentName(index: number): string {
  return INSTRUMENT_NAMES[index] ?? `INSTRUMENT_${index + 1}`;
}
