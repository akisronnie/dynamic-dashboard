import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';


import { integerValidator } from '../../shared/validators/integer.validator';
import { MarketProducerService } from '../../core/services/market-producer.service';
import { ProducerSettings } from '../../models/producer.model';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [ReactiveFormsModule, ButtonModule],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly producer = inject(MarketProducerService);
  private readonly router = inject(Router);

  readonly form;

  constructor() {
    const currentSettings = this.producer.getSettings();

    this.form = this.fb.nonNullable.group({
      instrumentCount: [
        currentSettings?.instrumentCount ?? 5,
        [Validators.required, Validators.min(1), Validators.max(50), integerValidator],
      ],

      updatesPerBatch: [
        currentSettings?.updatesPerBatch ?? 100,
        [Validators.required, Validators.min(1), Validators.max(1000), integerValidator],
      ],

      batchInterval: [
        currentSettings?.batchInterval ?? 500,
        [Validators.required, Validators.min(50), Validators.max(2000), integerValidator],
      ],
    });
  }

  apply(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const settings: ProducerSettings = {
      instrumentCount: this.form.controls.instrumentCount.value,
      updatesPerBatch: this.form.controls.updatesPerBatch.value,
      batchInterval: this.form.controls.batchInterval.value,
    };

    this.producer.start(settings);

    this.router.navigate(['/dashboard']);
  }

  reset(): void {
    const currentSettings = this.producer.getSettings();

    this.form.reset({
      instrumentCount: currentSettings?.instrumentCount ?? 5,
      updatesPerBatch: currentSettings?.updatesPerBatch ?? 100,
      batchInterval: currentSettings?.batchInterval ?? 500,
    });
  }

  get instrumentCountInvalid(): boolean {
    const control = this.form.controls.instrumentCount;
    return control.invalid && control.touched;
  }

  get updatesPerBatchInvalid(): boolean {
    const control = this.form.controls.updatesPerBatch;
    return control.invalid && control.touched;
  }

  get batchIntervalInvalid(): boolean {
    const control = this.form.controls.batchInterval;
    return control.invalid && control.touched;
  }
}
