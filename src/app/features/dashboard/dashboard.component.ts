import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { MarketProducerService } from '../../core/services/market-producer.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DecimalPipe, ButtonModule, TableModule, TagModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  private readonly producer = inject(MarketProducerService);
  readonly metrics = this.producer.metrics;
  readonly status = this.producer.status;
  readonly settings = this.producer.settings;
  readonly error = this.producer.error;

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

  start(): void {
    this.producer.start();
  }

  pause(): void {
    this.producer.pause();
  }

  resume(): void {
    this.producer.resume();
  }

  getTotalVolume(): number {
    return this.producer.getTotalVolume();
  }

  getAverageVwap(): string {
    return this.producer.getAverageVwap();
  }

  formatPrice(cents: number | null): string {
    return this.producer.formatPrice(cents);
  }

  formatImbalance(value: number | null): string {
    return this.producer.formatImbalance(value);
  }
}
