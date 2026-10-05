import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketProducerService } from '../../core/services/market-producer.service';
import { InstrumentMetrics } from '../../models/market.model';
import { ProducerSettings, ProducerStatus } from '../../models/producer.model';
import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent', () => {
  const metrics = signal<InstrumentMetrics[]>([]);
  const status = signal<ProducerStatus>('idle');
  const settings = signal<ProducerSettings>({
    instrumentCount: 2,
    updatesPerBatch: 25,
    batchInterval: 250,
  });
  const error = signal<string | null>(null);
  const producer = {
    metrics,
    status,
    settings,
    error,
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getTotalVolume: vi.fn(() => 42),
    getAverageVwap: vi.fn(() => '$12.34'),
    formatPrice: vi.fn((cents: number | null) =>
      cents === null ? '—' : `$${(cents / 100).toFixed(2)}`,
    ),
    formatImbalance: vi.fn((value: number | null) => (value === null ? '—' : value.toFixed(2))),
  };

  beforeEach(async () => {
    metrics.set([]);
    status.set('idle');
    settings.set({
      instrumentCount: 2,
      updatesPerBatch: 25,
      batchInterval: 250,
    });
    error.set(null);
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [{ provide: MarketProducerService, useValue: producer }],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  it.each([
    ['idle', 'Idle'],
    ['starting', 'Starting'],
    ['running', 'Live'],
    ['paused', 'Paused'],
    ['error', 'Error'],
  ] as const)('shows the %s status as %s', (producerStatus, label) => {
    status.set(producerStatus);
    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.statusLabel).toBe(label);
    expect(fixture.nativeElement.textContent).toContain(label);
  });

  it('delegates producer controls and summary calculations', () => {
    const component = TestBed.createComponent(DashboardComponent).componentInstance;

    component.start();
    component.pause();
    component.resume();

    expect(producer.start).toHaveBeenCalledOnce();
    expect(producer.pause).toHaveBeenCalledOnce();
    expect(producer.resume).toHaveBeenCalledOnce();
    expect(component.getTotalVolume()).toBe(42);
    expect(component.getAverageVwap()).toBe('$12.34');
    expect(producer.getTotalVolume).toHaveBeenCalledOnce();
    expect(producer.getAverageVwap).toHaveBeenCalledOnce();
  });

  it('delegates price and imbalance formatting', () => {
    const component = TestBed.createComponent(DashboardComponent).componentInstance;

    expect(component.formatPrice(1234)).toBe('$12.34');
    expect(component.formatPrice(null)).toBe('—');
    expect(component.formatImbalance(0.5)).toBe('0.50');
    expect(component.formatImbalance(null)).toBe('—');
    expect(producer.formatPrice).toHaveBeenNthCalledWith(1, 1234);
    expect(producer.formatPrice).toHaveBeenNthCalledWith(2, null);
    expect(producer.formatImbalance).toHaveBeenNthCalledWith(1, 0.5);
    expect(producer.formatImbalance).toHaveBeenNthCalledWith(2, null);
  });

  it('renders live instrument values and summary information', () => {
    metrics.set([
      {
        instrument: 'ALFA',
        lastPriceCents: 1234,
        spreadCents: 4,
        volume: 42,
        turnoverCents: 51828,
        vwapCents: 1234,
        imbalance: 0.5,
      },
    ]);
    status.set('running');

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('ALFA');
    expect(text).toContain('$12.34');
    expect(text).toContain('42');
    expect(text).toContain('Connected');
    expect(text).toContain('25 records');
  });
});
