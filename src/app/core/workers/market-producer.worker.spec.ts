import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { INSTRUMENT_NAMES } from '../../models/producer.model';

const UPDATE_FIELDS = 7;

type WasmExports = {
  memory: WebAssembly.Memory;
  initProducer: ReturnType<typeof vi.fn>;
  generateBatch: ReturnType<typeof vi.fn>;
  alloc: ReturnType<typeof vi.fn>;
};

type StartCommand = {
  type: 'start';
  runId: number;
  instrumentCount: number;
  updatesPerBatch: number;
  batchInterval: number;
};

type ProducerCommand =
  | StartCommand
  | {
      type: 'pause';
      runId: number;
    }
  | {
      type: 'resume';
      runId: number;
    };

type ProducerMessage =
  | {
      type: 'ready';
      runId: number;
    }
  | {
      type: 'paused';
      runId: number;
    }
  | {
      type: 'resumed';
      runId: number;
    }
  | {
      type: 'error';
      runId: number;
      message: string;
    }
  | {
      type: 'batch';
      runId: number;
      updates: Array<{
        instrument: string;
        priceCents: number;
        tradeQuantity: number;
        bidCents: number;
        askCents: number;
        bidQuantity: number;
        askQuantity: number;
      }>;
    };

type WorkerScope = {
  onmessage?: (event: MessageEvent<ProducerCommand>) => void;
  postMessage: ReturnType<typeof vi.fn>;
};

describe('market-producer.worker', () => {
  let worker: WorkerScope;
  let postMessage: ReturnType<typeof vi.fn>;

  let fetchMock: ReturnType<typeof vi.fn>;
  let instantiateMock: ReturnType<typeof vi.fn>;

  let wasm: WasmExports;

  beforeEach(async () => {
    vi.useFakeTimers();

    vi.resetModules();

    postMessage = vi.fn();

    worker = globalThis as unknown as WorkerScope;

    /*
     * The production worker uses:
     *
     * self.postMessage(...)
     *
     * In jsdom `self` is Window, and Window.postMessage requires
     * a targetOrigin argument. We replace it with a worker-like mock.
     */
    Object.defineProperty(worker, 'postMessage', {
      configurable: true,
      writable: true,
      value: postMessage,
    });

    /*
     * Create real WebAssembly memory so the worker can construct
     * Int32Array(memory.buffer, ...).
     */
    const memory = new WebAssembly.Memory({
      initial: 1,
    });

    const alloc = vi.fn(() => 0);

    const initProducer = vi.fn();

    const generateBatch = vi.fn((updateCount: number, outputPtr: number) => {
      const values = new Int32Array(memory.buffer, outputPtr, updateCount * UPDATE_FIELDS);

      for (let i = 0; i < updateCount; i++) {
        const offset = i * UPDATE_FIELDS;

        values[offset] = i;

        values[offset + 1] = 10000 + i;
        values[offset + 2] = 10 + i;

        values[offset + 3] = 9990 + i;
        values[offset + 4] = 10010 + i;

        values[offset + 5] = 100 + i;
        values[offset + 6] = 200 + i;
      }
    });

    wasm = {
      memory,
      alloc,
      initProducer,
      generateBatch,
    };

    fetchMock = vi.fn();

    instantiateMock = vi.fn(async () => ({
      instance: {
        exports: wasm,
      },
    }));

    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(WebAssembly, 'instantiate').mockImplementation(
      instantiateMock as typeof WebAssembly.instantiate,
    );

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    });

    /*
     * Import the worker after all globals have been mocked.
     */
    await import('./market-producer.worker');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function send(command: ProducerCommand): void {
    worker.onmessage?.({
      data: command,
    } as MessageEvent<ProducerCommand>);
  }

  async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  function getMessages<T extends ProducerMessage['type']>(
    type: T,
  ): Array<Extract<ProducerMessage, { type: T }>> {
    return postMessage.mock.calls
      .map(([message]) => message as ProducerMessage)
      .filter((message): message is Extract<ProducerMessage, { type: T }> => message.type === type);
  }

  describe('start', () => {
    it('should initialize WASM and emit ready', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 2,
        batchInterval: 1000,
      });

      await flushPromises();

      expect(fetchMock).toHaveBeenCalledTimes(1);

      expect(WebAssembly.instantiate).toHaveBeenCalledTimes(1);

      expect(wasm.alloc).toHaveBeenCalledWith(2 * UPDATE_FIELDS * 4);

      expect(wasm.initProducer).toHaveBeenCalledWith(10);

      expect(getMessages('ready')).toEqual([
        {
          type: 'ready',
          runId: 1,
        },
      ]);
    });

    it('should allocate the correct amount of output memory', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 50,
        updatesPerBatch: 100,
        batchInterval: 1000,
      });

      await flushPromises();

      expect(wasm.alloc).toHaveBeenCalledWith(100 * UPDATE_FIELDS * 4);
    });

    it('should initialize producer with the requested instrument count', async () => {
      send({
        type: 'start',
        runId: 42,
        instrumentCount: 123,
        updatesPerBatch: 10,
        batchInterval: 500,
      });

      await flushPromises();

      expect(wasm.initProducer).toHaveBeenCalledTimes(1);
      expect(wasm.initProducer).toHaveBeenCalledWith(123);
    });

    it('should emit an error when WASM fetch fails', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      send({
        type: 'start',
        runId: 7,
        instrumentCount: 10,
        updatesPerBatch: 5,
        batchInterval: 1000,
      });

      await flushPromises();

      expect(getMessages('error')).toEqual([
        {
          type: 'error',
          runId: 7,
          message: 'Failed to load WASM: 404 Not Found',
        },
      ]);

      expect(getMessages('ready')).toHaveLength(0);
    });

    it('should emit a normalized error when initialization throws a non-Error value', async () => {
      fetchMock.mockRejectedValueOnce('something went wrong');

      send({
        type: 'start',
        runId: 7,
        instrumentCount: 10,
        updatesPerBatch: 5,
        batchInterval: 1000,
      });

      await flushPromises();

      expect(getMessages('error')).toEqual([
        {
          type: 'error',
          runId: 7,
          message: 'Failed to initialize market producer',
        },
      ]);
    });
  });

  describe('batch generation', () => {
    it('should generate and publish batches on the configured interval', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 2,
        batchInterval: 1000,
      });

      await flushPromises();

      expect(getMessages('ready')).toHaveLength(1);

      expect(wasm.generateBatch).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);

      expect(wasm.generateBatch).toHaveBeenCalledTimes(1);
      expect(wasm.generateBatch).toHaveBeenCalledWith(2, 0);

      const batches = getMessages('batch');

      expect(batches).toHaveLength(1);

      expect(batches[0]).toEqual({
        type: 'batch',
        runId: 1,
        updates: [
          {
            instrument: INSTRUMENT_NAMES[0],
            priceCents: 10000,
            tradeQuantity: 10,
            bidCents: 9990,
            askCents: 10010,
            bidQuantity: 100,
            askQuantity: 200,
          },
          {
            instrument: INSTRUMENT_NAMES[1],
            priceCents: 10001,
            tradeQuantity: 11,
            bidCents: 9991,
            askCents: 10011,
            bidQuantity: 101,
            askQuantity: 201,
          },
        ],
      });
    });

    it('should generate batches repeatedly', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      vi.advanceTimersByTime(3000);

      expect(wasm.generateBatch).toHaveBeenCalledTimes(3);
      expect(getMessages('batch')).toHaveLength(3);
    });

    it('should not generate a batch before the interval expires', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      vi.advanceTimersByTime(999);

      expect(wasm.generateBatch).not.toHaveBeenCalled();
      expect(getMessages('batch')).toHaveLength(0);
    });
  });

  describe('pause', () => {
    it('should emit paused for the current run', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      send({
        type: 'pause',
        runId: 1,
      });

      expect(getMessages('paused')).toEqual([
        {
          type: 'paused',
          runId: 1,
        },
      ]);
    });

    it('should stop batch generation while paused', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      send({
        type: 'pause',
        runId: 1,
      });

      vi.advanceTimersByTime(5000);

      expect(wasm.generateBatch).not.toHaveBeenCalled();
      expect(getMessages('batch')).toHaveLength(0);
    });

    it('should ignore pause from an old run', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      send({
        type: 'pause',
        runId: 999,
      });

      expect(getMessages('paused')).toHaveLength(0);
    });

    it('should ignore duplicate pause commands', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      send({
        type: 'pause',
        runId: 1,
      });

      send({
        type: 'pause',
        runId: 1,
      });

      expect(getMessages('paused')).toHaveLength(1);
    });
  });

  describe('resume', () => {
    it('should emit resumed for the current paused run', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      send({
        type: 'pause',
        runId: 1,
      });

      send({
        type: 'resume',
        runId: 1,
      });

      expect(getMessages('resumed')).toEqual([
        {
          type: 'resumed',
          runId: 1,
        },
      ]);
    });

    it('should resume batch generation', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      send({
        type: 'pause',
        runId: 1,
      });

      vi.advanceTimersByTime(3000);

      expect(wasm.generateBatch).not.toHaveBeenCalled();

      send({
        type: 'resume',
        runId: 1,
      });

      vi.advanceTimersByTime(1000);

      expect(wasm.generateBatch).toHaveBeenCalledTimes(1);
    });

    it('should ignore resume when the producer is not paused', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      send({
        type: 'resume',
        runId: 1,
      });

      expect(getMessages('resumed')).toHaveLength(0);
    });

    it('should ignore resume from an old run', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      send({
        type: 'pause',
        runId: 1,
      });

      send({
        type: 'resume',
        runId: 999,
      });

      expect(getMessages('resumed')).toHaveLength(0);
    });
  });

  describe('run lifecycle', () => {
    it('should stop the previous timer when a new run starts', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      vi.advanceTimersByTime(1000);

      expect(wasm.generateBatch).toHaveBeenCalledTimes(1);

      send({
        type: 'start',
        runId: 2,
        instrumentCount: 20,
        updatesPerBatch: 2,
        batchInterval: 1000,
      });

      await flushPromises();

      vi.clearAllMocks();

      vi.advanceTimersByTime(1000);

      expect(wasm.generateBatch).toHaveBeenCalledTimes(1);

      expect(getMessages('batch')).toHaveLength(1);
    });

    it('should invalidate the previous async initialization when a new run starts', async () => {
      let resolveFirstFetch!: (response: Response) => void;
      let resolveSecondFetch!: (response: Response) => void;

      const firstFetch = new Promise<Response>((resolve) => {
        resolveFirstFetch = resolve;
      });

      const secondFetch = new Promise<Response>((resolve) => {
        resolveSecondFetch = resolve;
      });

      fetchMock.mockReturnValueOnce(firstFetch).mockReturnValueOnce(secondFetch);

      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      send({
        type: 'start',
        runId: 2,
        instrumentCount: 20,
        updatesPerBatch: 2,
        batchInterval: 1000,
      });

      await flushPromises();

      resolveFirstFetch({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      } as unknown as Response);

      await flushPromises();

      /*
       * First initialization must be ignored because run 2
       * invalidated generation 1.
       */
      expect(getMessages('ready')).toHaveLength(0);
      expect(wasm.initProducer).not.toHaveBeenCalled();

      resolveSecondFetch({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      } as unknown as Response);

      await flushPromises();

      expect(getMessages('ready')).toEqual([
        {
          type: 'ready',
          runId: 2,
        },
      ]);

      expect(wasm.initProducer).toHaveBeenCalledWith(20);
    });

    it('should ignore an obsolete initialization error', async () => {
      let rejectFirstFetch!: (error: unknown) => void;

      const firstFetch = new Promise<Response>((_, reject) => {
        rejectFirstFetch = reject;
      });

      fetchMock.mockReturnValueOnce(firstFetch);

      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      send({
        type: 'start',
        runId: 2,
        instrumentCount: 20,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      rejectFirstFetch(new Error('Old initialization failed'));

      await flushPromises();

      expect(getMessages('error')).toHaveLength(0);
    });

    it('should only publish batches for the current run', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      send({
        type: 'start',
        runId: 2,
        instrumentCount: 20,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      vi.advanceTimersByTime(1000);

      const batches = getMessages('batch');

      expect(batches).toHaveLength(1);
      expect(batches[0].runId).toBe(2);
    });
  });

  describe('instrument names', () => {
    it('should use INSTRUMENT_NAMES for known indexes', async () => {
      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      vi.advanceTimersByTime(1000);

      const batch = getMessages('batch')[0];

      expect(batch.updates[0].instrument).toBe(INSTRUMENT_NAMES[0]);
    });

    it('should use a fallback name for an unknown instrument index', async () => {
      wasm.generateBatch.mockImplementationOnce((updateCount: number, outputPtr: number) => {
        const values = new Int32Array(wasm.memory.buffer, outputPtr, updateCount * UPDATE_FIELDS);

        values[0] = 999;

        values[1] = 10000;
        values[2] = 10;
        values[3] = 9990;
        values[4] = 10010;
        values[5] = 100;
        values[6] = 200;
      });

      send({
        type: 'start',
        runId: 1,
        instrumentCount: 10,
        updatesPerBatch: 1,
        batchInterval: 1000,
      });

      await flushPromises();

      vi.advanceTimersByTime(1000);

      const batch = getMessages('batch')[0];

      expect(batch.updates[0].instrument).toBe('INSTRUMENT_1000');
    });
  });
});
