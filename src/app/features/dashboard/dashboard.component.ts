
import {
  ChangeDetectionStrategy,
  Component,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';

import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import {
  MarketProducerService,
  ProducerStatus,
} from '../../core/services/market-producer.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    DecimalPipe,
    ButtonModule,
    TableModule,
    TagModule,
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  readonly metrics;
  readonly status;
  readonly settings;
  readonly error;

  constructor(
    private readonly producer: MarketProducerService,
  ) {
    this.metrics = this.producer.metrics;
    this.status = this.producer.status;
    this.settings = this.producer.settings;
    this.error = this.producer.error;
  }

  get statusLabel(): string {
    switch (this.status()) {
      case 'running':
        return 'Live';

      case 'paused':
        return 'Paused';

      case 'starting':
        return 'Starting';

      case 'error':
        return 'Error';

      default:
        return 'Idle';
    }
  }

  get statusSeverity():
    | 'success'
    | 'warn'
    | 'secondary' {
    switch (this.status()) {
      case 'running':
        return 'success';

      case 'paused':
        return 'warn';

      default:
        return 'secondary';
    }
  }

  start(): void {
    this.producer.start(
      this.producer.getSettings(),
    );
  }

  pause(): void {
    this.producer.pause();
  }

  resume(): void {
    this.producer.resume();
  }

  // stop(): void {
  //   this.producer.stop();
  // }

  getTotalVolume(): number {
    return this.producer.getTotalVolume();
  }

  getAverageVwap(): string {
    return this.producer.getAverageVwap();
  }

  formatPrice(
    cents: number | null,
  ): string {
    return this.producer.formatPrice(cents);
  }

  formatImbalance(
    value: number | null,
  ): string {
    return this.producer.formatImbalance(value);
  }

  isRunning(): boolean {
    return this.status() === 'running';
  }

  isPaused(): boolean {
    return this.status() === 'paused';
  }

  isStarting(): boolean {
    return this.status() === 'starting';
  }

  canPause(): boolean {
    return (
      this.status() === 'running' ||
      this.status() === 'starting'
    );
  }

  canResume(): boolean {
    return this.status() === 'paused';
  }
}




// import { Component, OnDestroy, OnInit, signal } from '@angular/core';
// import { DecimalPipe } from '@angular/common';
//
// import { ButtonModule } from 'primeng/button';
// import { TableModule } from 'primeng/table';
// import { TagModule } from 'primeng/tag';
//
// import {
//   MarketProducerService,
//   ProducerStatus,
// } from '../../core/services/market-producer.service';
//
// import { MarketUpdate } from '../../core/models/market-update.model';
//
// interface InstrumentState {
//   instrument: string;
//   lastPrice?: number;
//   bidCents?: number;
//   askCents?: number;
//   bidQuantity?: number;
//   askQuantity?: number;
//   volume: number;
//   turnover: number;
// }
//
// interface InstrumentMetrics {
//   instrument: string;
//   lastPrice: number;
//   spread: number;
//   volume: number;
//   vwap: number;
//   imbalance: number;
// }
//
// @Component({
//   selector: 'app-dashboard',
//   standalone: true,
//   imports: [
//     DecimalPipe,
//     ButtonModule,
//     TableModule,
//     TagModule,
//   ],
//   templateUrl: 'dashboard.component.html',
//   styleUrls: ['dashboard.component.scss'],
// })
// export class DashboardComponent implements OnInit, OnDestroy {
//   readonly metrics = signal<InstrumentMetrics[]>([]);
//   readonly status = signal<ProducerStatus>('idle');
//   batchesReceived = 0;
//
//   /**
//    * Cumulative state for the current producer run.
//    *
//    * This is intentionally kept in the dashboard/service layer
//    * instead of keeping the complete trade history.
//    */
//   private readonly instrumentStates = new Map<string, InstrumentState>();
//
//   constructor(
//     private readonly producer: MarketProducerService,
//   ) {}
//
//   get statusLabel(): string {
//     switch (this.status()) {
//       case 'running':
//         return 'Live';
//
//       case 'paused':
//         return 'Paused';
//
//       case 'starting':
//         return 'Starting';
//
//       case 'error':
//         return 'Error';
//
//       default:
//         return 'Idle';
//     }
//   }
//
//   get statusSeverity(): 'success' | 'warn' | 'secondary' {
//     switch (this.status()) {
//       case 'running':
//         return 'success';
//
//       case 'paused':
//         return 'warn';
//
//       default:
//         return 'secondary';
//     }
//   }
//
//   ngOnInit(): void {
//     this.producer.onStatusChange((status: ProducerStatus) => {
//       this.status.set(status);
//     });
//
//     this.producer.onBatch((batch) => {
//       this.batchesReceived++;
//
//       this.processBatch(batch.updates);
//     });
//   }
//
//   /**
//    * Starts a completely new producer run.
//    *
//    * All cumulative values from the previous run are cleared.
//    */
//   start(): void {
//     this.resetRun();
//
//     this.producer.start({
//       instrumentCount: 5,
//       updatesPerBatch: 100,
//       batchInterval: 500,
//     });
//   }
//
//   pause(): void {
//     this.producer.pause();
//   }
//
//   resume(): void {
//     this.producer.resume();
//   }
//
//   stop(): void {
//     this.producer.stop();
//
//     this.resetRun();
//   }
//
//   /**
//    * Processes every generated trade exactly once.
//    *
//    * We don't retain the complete event history.
//    * Instead, only cumulative per-instrument state is retained.
//    */
//   private processBatch(updates: MarketUpdate[]): void {
//     for (const update of updates) {
//       let state = this.instrumentStates.get(update.instrument);
//
//       if (!state) {
//         state = {
//           instrument: update.instrument,
//           volume: 0,
//           turnover: 0,
//         };
//
//         this.instrumentStates.set(update.instrument, state);
//       }
//
//       /*
//        * Every generated trade contributes to cumulative volume.
//        */
//       state.volume += update.tradeQuantity;
//
//       /*
//        * VWAP numerator:
//        *
//        * sum(tradePrice * tradeQuantity)
//        */
//       state.turnover +=
//         update.priceCents * update.tradeQuantity;
//
//       /*
//        * Latest trade price.
//        */
//       state.lastPrice = update.priceCents;
//
//       /*
//        * Latest order-book snapshot.
//        */
//       state.bidCents = update.bidCents;
//       state.askCents = update.askCents;
//
//       state.bidQuantity = update.bidQuantity;
//       state.askQuantity = update.askQuantity;
//     }
//
//     this.rebuildMetrics();
//   }
//
//   /**
//    * Converts cumulative internal state into the data consumed by the table.
//    */
//   private rebuildMetrics(): void {
//     const result: InstrumentMetrics[] = [];
//
//     for (const state of this.instrumentStates.values()) {
//       /*
//        * VWAP:
//        *
//        * sum(price * quantity) / sum(quantity)
//        */
//       const vwap =
//         state.volume > 0
//           ? state.turnover / state.volume
//           : 0;
//
//       /*
//        * Spread is based on the latest available bid/ask snapshot.
//        */
//       const spread =
//         state.bidCents !== undefined &&
//         state.askCents !== undefined
//           ? state.askCents - state.bidCents
//           : 0;
//
//       /*
//        * Imbalance:
//        *
//        * (bidQuantity - askQuantity)
//        * / (bidQuantity + askQuantity)
//        */
//       const totalBookQuantity =
//         (state.bidQuantity ?? 0) +
//         (state.askQuantity ?? 0);
//
//       const imbalance =
//         totalBookQuantity > 0
//           ? (
//           (state.bidQuantity ?? 0) -
//           (state.askQuantity ?? 0)
//         ) / totalBookQuantity
//           : 0;
//
//       result.push({
//         instrument: state.instrument,
//
//         /*
//          * The table currently expects numbers.
//          * 0 means unavailable internally and can be changed
//          * to an explicit unavailable representation later if needed.
//          */
//         lastPrice: state.lastPrice ?? 0,
//
//         spread,
//
//         volume: state.volume,
//
//         vwap,
//
//         imbalance,
//       });
//     }
//
//     result.sort((a, b) =>
//       a.instrument.localeCompare(b.instrument),
//     );
//
//     this.metrics.set(result);
//   }
//
//   private resetRun(): void {
//     this.batchesReceived = 0;
//
//     this.instrumentStates.clear();
//
//     this.metrics.set([]);
//   }
//
//   formatPrice(cents: number): string {
//     if (cents === 0) {
//       return '—';
//     }
//
//     return `$${(cents / 100).toFixed(2)}`;
//   }
//
//   formatImbalance(value: number): string {
//     if (value === 0) {
//       return '—';
//     }
//
//     const sign = value >= 0 ? '+' : '';
//
//     return `${sign}${value.toFixed(2)}`;
//   }
//
//   getTotalVolume(): number {
//     return Array.from(this.instrumentStates.values())
//       .reduce(
//         (total, state) => total + state.volume,
//         0,
//       );
//   }
//
//   /**
//    * Global VWAP for the whole current run.
//    *
//    * This is NOT the arithmetic average of instrument VWAPs.
//    *
//    * global VWAP =
//    * sum(all trade price * quantity)
//    * / sum(all trade quantity)
//    */
//   getAverageVwap(): string {
//     let totalVolume = 0;
//     let totalTurnover = 0;
//
//     for (const state of this.instrumentStates.values()) {
//       totalVolume += state.volume;
//       totalTurnover += state.turnover;
//     }
//
//     if (totalVolume === 0) {
//       return '—';
//     }
//
//     return this.formatPrice(
//       totalTurnover / totalVolume,
//     );
//   }
//
//   ngOnDestroy(): void {
//     /*
//      * Do NOT stop or terminate the producer here.
//      *
//      * MarketProducerService is a root singleton and must survive
//      * navigation between Dashboard and Settings.
//      */
//   }
// }
