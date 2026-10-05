import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { MarketProducerService } from './market-producer.service';
import { ProducerMessage, StartCommand } from '../../models/producer-message.model';
import { ProducerSettings } from '../../models/producer.model';

describe('MarketProducerService', () => {
  let service: MarketProducerService;

  let worker: {
    onmessage: ((event: MessageEvent<ProducerMessage>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  };

  const settings = (overrides: Partial<ProducerSettings> = {}): ProducerSettings => ({
    instrumentCount: 2,
    updatesPerBatch: 10,
    batchInterval: 100,
    ...overrides,
  });

  const update = (
    instrument: string,
    priceCents: number,
    tradeQuantity: number,
    bidQuantity = 10,
    askQuantity = 10,
  ) => ({
    instrument,
    priceCents,
    tradeQuantity,
    bidCents: priceCents - 1,
    askCents: priceCents + 1,
    bidQuantity,
    askQuantity,
  });

  const send = (message: ProducerMessage): void => {
    worker.onmessage?.({
      data: message,
    } as MessageEvent<ProducerMessage>);
  };

  beforeEach(() => {
    worker = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };

    vi.stubGlobal(
      'Worker',
      vi.fn(function WorkerMock() {
        return worker;
      }),
    );

    TestBed.configureTestingModule({
      providers: [MarketProducerService],
    });

    service = TestBed.inject(MarketProducerService);
  });

  afterEach(() => {
    service?.destroy();

    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  describe('metrics', () => {
    it('calculates cumulative metrics from the worked price/quantity example', () => {
      service.start(settings());

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 100, 2, 3, 1), update('ALFA', 200, 3, 1, 3)],
      });

      const alfa = service.metrics().find((metric) => metric.instrument === 'ALFA');

      expect(alfa).toEqual({
        instrument: 'ALFA',
        lastPriceCents: 200,
        spreadCents: 2,
        volume: 5,
        turnoverCents: 800,
        vwapCents: 160,
        imbalance: -0.5,
      });

      expect(service.getTotalVolume()).toBe(5);
      expect(service.getAverageVwap()).toBe('$1.60');
    });

    it('accumulates metrics independently for each instrument', () => {
      service.start(settings());

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 100, 2), update('BETA', 300, 4)],
      });

      expect(
        service.metrics().map(({ instrument, volume, vwapCents }) => ({
          instrument,
          volume,
          vwapCents,
        })),
      ).toEqual([
        {
          instrument: 'ALFA',
          volume: 2,
          vwapCents: 100,
        },
        {
          instrument: 'BETA',
          volume: 4,
          vwapCents: 300,
        },
      ]);
    });

    it('accumulates subsequent batches instead of replacing previous metrics', () => {
      service.start(settings());

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 100, 2)],
      });

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 200, 3)],
      });

      const alfa = service.metrics().find((metric) => metric.instrument === 'ALFA');

      expect(alfa).toMatchObject({
        volume: 5,
        turnoverCents: 800,
        vwapCents: 160,
        lastPriceCents: 200,
      });
    });

    it('keeps VWAP and imbalance unavailable when their denominators are zero', () => {
      service.start(settings({ instrumentCount: 1 }));

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 100, 0, 0, 0)],
      });

      expect(service.metrics()[0]).toMatchObject({
        volume: 0,
        turnoverCents: 0,
        vwapCents: null,
        imbalance: null,
      });

      expect(service.getAverageVwap()).toBe('—');
    });

    it('calculates average VWAP using total turnover divided by total volume', () => {
      service.start(settings());

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 100, 2), update('BETA', 300, 4)],
      });

      // Total turnover = 200 + 1200 = 1400
      // Total volume = 2 + 4 = 6
      // Average VWAP = 1400 / 6 = 233.33 cents
      expect(service.getAverageVwap()).toBe('$2.33');
    });

    it('calculates spread from ask price minus bid price', () => {
      service.start(settings({ instrumentCount: 1 }));

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 100, 5)],
      });

      expect(service.metrics()[0].spreadCents).toBe(2);
    });

    it('uses the latest trade price while keeping cumulative volume and turnover', () => {
      service.start(settings({ instrumentCount: 1 }));

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 100, 2)],
      });

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 150, 3)],
      });

      expect(service.metrics()[0]).toMatchObject({
        lastPriceCents: 150,
        volume: 5,
        turnoverCents: 650,
        vwapCents: 130,
      });
    });
  });

  describe('run lifecycle', () => {
    it('starts a run with the requested settings', () => {
      const requestedSettings = settings({
        instrumentCount: 3,
        updatesPerBatch: 25,
        batchInterval: 250,
      });

      service.start(requestedSettings);

      expect(service.getSettings()).toEqual(requestedSettings);
      expect(service.status()).toBe('starting');

      expect(worker.postMessage).toHaveBeenCalledWith({
        type: 'start',
        runId: 1,
        instrumentCount: 3,
        updatesPerBatch: 25,
        batchInterval: 250,
      } satisfies StartCommand);
    });

    it('initializes all instrument rows when a run starts', () => {
      service.start(settings({ instrumentCount: 3 }));

      expect(service.metrics()).toHaveLength(3);

      expect(service.metrics()).toEqual([
        {
          instrument: 'ALFA',
          lastPriceCents: null,
          spreadCents: null,
          volume: 0,
          turnoverCents: 0,
          vwapCents: null,
          imbalance: null,
        },
        {
          instrument: 'BETA',
          lastPriceCents: null,
          spreadCents: null,
          volume: 0,
          turnoverCents: 0,
          vwapCents: null,
          imbalance: null,
        },
        {
          instrument: 'GAMMA',
          lastPriceCents: null,
          spreadCents: null,
          volume: 0,
          turnoverCents: 0,
          vwapCents: null,
          imbalance: null,
        },
      ]);
    });

    it('moves from starting to running when the worker becomes ready', () => {
      service.start(settings());

      expect(service.status()).toBe('starting');

      send({
        type: 'ready',
        runId: 1,
      });

      expect(service.status()).toBe('running');
    });

    it('moves from starting to running when the first batch arrives', () => {
      service.start(settings());

      expect(service.status()).toBe('starting');

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 100, 1)],
      });

      expect(service.status()).toBe('running');
    });

    it('resets metrics and error state when a new run starts', () => {
      service.start(settings({ instrumentCount: 2 }));

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 100, 4)],
      });

      send({
        type: 'error',
        runId: 1,
        message: 'Test error',
      });

      expect(service.error()).toBe('Test error');

      const nextSettings = settings({
        instrumentCount: 1,
        updatesPerBatch: 7,
        batchInterval: 250,
      });

      service.start(nextSettings);

      expect(service.getSettings()).toEqual(nextSettings);
      expect(service.error()).toBeNull();

      expect(service.metrics()).toEqual([
        {
          instrument: 'ALFA',
          lastPriceCents: null,
          spreadCents: null,
          volume: 0,
          turnoverCents: 0,
          vwapCents: null,
          imbalance: null,
        },
      ]);

      expect(service.status()).toBe('starting');
    });
  });

  describe('pause and resume', () => {
    it('sends pause for a starting run', () => {
      service.start(settings());

      service.pause();

      expect(worker.postMessage).toHaveBeenLastCalledWith({
        type: 'pause',
        runId: 1,
      });
    });

    it('sends pause for a running run', () => {
      service.start(settings());

      send({
        type: 'ready',
        runId: 1,
      });

      service.pause();

      expect(worker.postMessage).toHaveBeenLastCalledWith({
        type: 'pause',
        runId: 1,
      });
    });

    it('changes status to paused after worker confirmation', () => {
      service.start(settings());

      send({
        type: 'ready',
        runId: 1,
      });

      service.pause();

      send({
        type: 'paused',
        runId: 1,
      });

      expect(service.status()).toBe('paused');
    });

    it('sends resume for a paused run', () => {
      service.start(settings());

      send({
        type: 'ready',
        runId: 1,
      });

      service.pause();

      send({
        type: 'paused',
        runId: 1,
      });

      service.resume();

      expect(worker.postMessage).toHaveBeenLastCalledWith({
        type: 'resume',
        runId: 1,
      });
    });

    it('changes status to running after worker confirms resume', () => {
      service.start(settings());

      send({
        type: 'ready',
        runId: 1,
      });

      service.pause();

      send({
        type: 'paused',
        runId: 1,
      });

      service.resume();

      send({
        type: 'resumed',
        runId: 1,
      });

      expect(service.status()).toBe('running');
    });

    it('does nothing when pause is requested while idle', () => {
      service.pause();

      expect(worker.postMessage).not.toHaveBeenCalled();
    });

    it('does nothing when pause is requested while already paused', () => {
      service.start(settings());

      send({
        type: 'ready',
        runId: 1,
      });

      service.pause();

      send({
        type: 'paused',
        runId: 1,
      });

      worker.postMessage.mockClear();

      service.pause();

      expect(worker.postMessage).not.toHaveBeenCalled();
    });

    it('does nothing when resume is requested while not paused', () => {
      service.start(settings());

      worker.postMessage.mockClear();

      service.resume();

      expect(worker.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('stale run protection', () => {
    it('ignores a batch from a previous run', () => {
      service.start(settings());

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 100, 5)],
      });

      service.start(settings());

      expect(service.metrics()[0]).toMatchObject({
        volume: 0,
        turnoverCents: 0,
        lastPriceCents: null,
      });

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 500, 9)],
      });

      expect(service.metrics()[0]).toMatchObject({
        volume: 0,
        turnoverCents: 0,
        lastPriceCents: null,
      });
    });

    it('ignores a ready message from a previous run', () => {
      service.start(settings());

      send({
        type: 'ready',
        runId: 1,
      });

      expect(service.status()).toBe('running');

      service.start(settings());

      expect(service.status()).toBe('starting');

      send({
        type: 'ready',
        runId: 1,
      });

      expect(service.status()).toBe('starting');
    });

    it('ignores pause/resume messages from a previous run', () => {
      service.start(settings());

      send({
        type: 'ready',
        runId: 1,
      });

      service.start(settings());

      expect(service.status()).toBe('starting');

      send({
        type: 'paused',
        runId: 1,
      });

      expect(service.status()).toBe('starting');

      send({
        type: 'resumed',
        runId: 1,
      });

      expect(service.status()).toBe('starting');
    });

    it('accepts messages from the current run', () => {
      service.start(settings());

      send({
        type: 'ready',
        runId: 1,
      });

      expect(service.status()).toBe('running');

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 100, 2)],
      });

      expect(service.metrics()[0]).toMatchObject({
        volume: 2,
        lastPriceCents: 100,
      });
    });
  });

  describe('worker errors', () => {
    it('enters error state when the worker reports an error message', () => {
      service.start(settings());

      send({
        type: 'error',
        runId: 1,
        message: 'Generator failed',
      });

      expect(service.error()).toBe('Generator failed');
      expect(service.status()).toBe('error');
    });

    it('enters error state when the Worker itself fails', () => {
      service.start(settings());

      worker.onerror?.({
        message: 'Worker crashed',
      } as ErrorEvent);

      expect(service.error()).toBe('Worker crashed');
      expect(service.status()).toBe('error');
    });

    it('uses the fallback error message when Worker error has no message', () => {
      service.start(settings());

      worker.onerror?.({
        message: '',
      } as ErrorEvent);

      expect(service.error()).toBe('Market producer worker failed.');
      expect(service.status()).toBe('error');
    });

    it('ignores a worker error message from a previous run', () => {
      service.start(settings());

      send({
        type: 'ready',
        runId: 1,
      });

      service.start(settings());

      send({
        type: 'error',
        runId: 1,
        message: 'Old run failed',
      });

      expect(service.error()).toBeNull();
      expect(service.status()).toBe('starting');
    });
  });

  describe('formatting', () => {
    it('formats prices in dollars with two decimal places', () => {
      expect(service.formatPrice(null)).toBe('—');
      expect(service.formatPrice(0)).toBe('$0.00');
      expect(service.formatPrice(123)).toBe('$1.23');
      expect(service.formatPrice(10000)).toBe('$100.00');
    });

    it('formats imbalance with an explicit positive sign', () => {
      expect(service.formatImbalance(null)).toBe('—');
      expect(service.formatImbalance(0)).toBe('+0.00');
      expect(service.formatImbalance(0.5)).toBe('+0.50');
      expect(service.formatImbalance(-0.5)).toBe('-0.50');
    });
  });

  describe('destroy', () => {
    it('terminates the worker and invalidates the current run', () => {
      service.start(settings());

      service.destroy();

      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(service.status()).toBe('idle');
      expect(service.metrics()).toEqual([]);
      expect(service.error()).toBeNull();
    });

    it('ignores messages received after destroy', () => {
      service.start(settings());

      service.destroy();

      send({
        type: 'batch',
        runId: 1,
        updates: [update('ALFA', 100, 5)],
      });

      expect(service.metrics()).toEqual([]);
      expect(service.status()).toBe('idle');
    });
  });
});
