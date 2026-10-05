import { Injectable, signal } from '@angular/core';
import { INSTRUMENT_NAMES, ProducerSettings, ProducerStatus } from '../../models/producer.model';
import { InstrumentMetrics, MarketUpdate } from '../../models/market.model';
import { BatchMessage, ProducerMessage, StartCommand } from '../../models/producer-message.model';


const DEFAULT_SETTINGS: ProducerSettings = {
  instrumentCount: 5,
  updatesPerBatch: 100,
  batchInterval: 500,
};

@Injectable({
  providedIn: 'root',
})
export class MarketProducerService {
  private readonly worker = new Worker(
    new URL('../workers/market-producer.worker', import.meta.url),
    { type: 'module' },
  );
  private runId = 0;
  private readonly settingsState = signal<ProducerSettings>({
    ...DEFAULT_SETTINGS,
  });
  private readonly statusState = signal<ProducerStatus>('idle');
  private readonly metricsState = signal<InstrumentMetrics[]>([]);
  private readonly errorState = signal<string | null>(null);

  readonly settings = this.settingsState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly metrics = this.metricsState.asReadonly();
  readonly error = this.errorState.asReadonly();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<ProducerMessage>) => {
      this.handleWorkerMessage(event.data);
    };

    this.worker.onerror = (error) => {
      console.error('Market producer worker error:', error);

      this.errorState.set(error.message || 'Market producer worker failed.');

      this.setStatus('error');
    };

    this.initializeInstruments(DEFAULT_SETTINGS.instrumentCount);
  }

  start(settings: ProducerSettings = this.settingsState()): void {
    this.runId++;

    const currentRunId = this.runId;

    this.settingsState.set({
      ...settings,
    });

    this.clearRunState();

    this.initializeInstruments(settings.instrumentCount);

    this.setStatus('starting');

    const command: StartCommand = {
      type: 'start',
      runId: currentRunId,
      instrumentCount: settings.instrumentCount,
      updatesPerBatch: settings.updatesPerBatch,
      batchInterval: settings.batchInterval,
    };

    this.worker.postMessage(command);
  }

  pause(): void {
    const currentStatus = this.statusState();

    if (currentStatus !== 'running' && currentStatus !== 'starting') {
      return;
    }

    this.worker.postMessage({
      type: 'pause',
      runId: this.runId,
    });
  }

  resume(): void {
    if (this.statusState() !== 'paused') {
      return;
    }

    this.worker.postMessage({
      type: 'resume',
      runId: this.runId,
    });
  }

  getSettings(): ProducerSettings {
    return {
      ...this.settingsState(),
    };
  }

  getTotalVolume(): number {
    return this.metricsState().reduce((total, metric) => total + metric.volume, 0);
  }

  getAverageVwap(): string {
    let totalVolume = 0;
    let totalTurnoverCents = 0;

    for (const metric of this.metricsState()) {
      totalVolume += metric.volume;
      totalTurnoverCents += metric.turnoverCents;
    }

    if (totalVolume === 0) {
      return '—';
    }

    return this.formatPrice(totalTurnoverCents / totalVolume);
  }

  /**
   * Main worker message handler.
   */
  private handleWorkerMessage(message: ProducerMessage): void {
    /**
     * Critical stale-run protection.
     *
     * A batch from an old run must NEVER modify
     * the state of the current run.
     */
    if (message.runId !== this.runId) {
      console.warn('Ignoring stale producer message', {
        messageRunId: message.runId,
        currentRunId: this.runId,
      });

      return;
    }

    switch (message.type) {
      case 'ready':
        this.setStatus('running');
        break;

      case 'batch':
        this.handleBatch(message);
        break;

      case 'paused':
        this.setStatus('paused');
        break;

      case 'resumed':
        this.setStatus('running');
        break;

      case 'error':
        console.error('Producer error:', message.message);

        this.errorState.set(message.message);
        this.setStatus('error');
        break;
    }
  }

  /**
   * Processes one generated batch.
   *
   * WASM produces raw market updates.
   * The service transforms them into dashboard metrics.
   */
  private handleBatch(message: BatchMessage): void {
    const currentMetrics = new Map<string, InstrumentMetrics>();

    /**
     * Map preserves the order in which instruments
     * were initialized.
     */
    for (const metric of this.metricsState()) {
      currentMetrics.set(metric.instrument, {
        ...metric,
      });
    }

    for (const update of message.updates) {
      this.processUpdate(currentMetrics, update);
    }

    this.metricsState.set(Array.from(currentMetrics.values()));

    if (this.statusState() === 'starting') {
      this.setStatus('running');
    }
  }

  /**
   * Applies one raw market update to cumulative
   * instrument state.
   */
  private processUpdate(metricsMap: Map<string, InstrumentMetrics>, update: MarketUpdate): void {
    const previous = metricsMap.get(update.instrument);

    /**
     * Instrument should normally already exist because
     * start() initializes all rows before data arrives.
     *
     * This fallback makes the service resilient to an
     * unexpected instrument from the worker.
     */
    if (!previous) {
      const volume = update.tradeQuantity;

      const turnoverCents = update.priceCents * update.tradeQuantity;

      metricsMap.set(update.instrument, {
        instrument: update.instrument,
        lastPriceCents: update.priceCents,
        spreadCents: update.askCents - update.bidCents,
        volume,
        turnoverCents,
        vwapCents: volume > 0 ? turnoverCents / volume : null,
        imbalance: this.calculateImbalance(update.bidQuantity, update.askQuantity),
      });

      return;
    }

    const volume = previous.volume + update.tradeQuantity;

    const turnoverCents = previous.turnoverCents + update.priceCents * update.tradeQuantity;

    metricsMap.set(update.instrument, {
      instrument: previous.instrument,
      lastPriceCents: update.priceCents,
      spreadCents: update.askCents - update.bidCents,
      volume,
      turnoverCents,
      vwapCents: volume > 0 ? turnoverCents / volume : null,
      imbalance: this.calculateImbalance(update.bidQuantity, update.askQuantity),
    });
  }

  /**
   * Creates all dashboard rows immediately when
   * a new run starts.
   *
   * Rows therefore exist before the first generated update.
   */
  private initializeInstruments(instrumentCount: number): void {
    const metrics: InstrumentMetrics[] = [];

    for (let index = 0; index < instrumentCount; index++) {
      metrics.push({
        instrument: this.getInstrumentName(index),
        lastPriceCents: null,
        spreadCents: null,
        volume: 0,
        turnoverCents: 0,
        vwapCents: null,
        imbalance: null,
      });
    }

    this.metricsState.set(metrics);
  }

  private getInstrumentName(index: number): string {
    return INSTRUMENT_NAMES[index] ?? `INSTRUMENT_${index + 1}`;
  }

  /**
   * Order-book imbalance:
   *
   * (bid - ask) / (bid + ask)
   *
   * If both sides are zero, the metric is unavailable.
   */
  private calculateImbalance(bidQuantity: number, askQuantity: number): number | null {
    const denominator = bidQuantity + askQuantity;

    if (denominator === 0) {
      return null;
    }

    return (bidQuantity - askQuantity) / denominator;
  }

  formatPrice(cents: number | null): string {
    if (cents === null) {
      return '—';
    }

    return `$${(cents / 100).toFixed(2)}`;
  }

  formatImbalance(value: number | null): string {
    if (value === null) {
      return '—';
    }

    const sign = value >= 0 ? '+' : '';

    return `${sign}${value.toFixed(2)}`;
  }

  private clearRunState(): void {
    this.metricsState.set([]);
    this.errorState.set(null);
  }

  private setStatus(status: ProducerStatus): void {
    this.statusState.set(status);
  }

  destroy(): void {
    this.runId++;
    this.worker.terminate();
    this.clearRunState();
    this.setStatus('idle');
  }
}
