import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SettingsComponent } from './settings.component';
import { MarketProducerService } from '../../core/services/market-producer.service';
import { ProducerSettings } from '../../models/producer.model';

describe('SettingsComponent', () => {
  const savedSettings: ProducerSettings = {
    instrumentCount: 5,
    updatesPerBatch: 100,
    batchInterval: 500,
  };
  let currentSettings: ProducerSettings;
  let start: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    currentSettings = { ...savedSettings };
    start = vi.fn((settings: ProducerSettings) => {
      currentSettings = { ...settings };
    });
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        provideRouter([]),
        {
          provide: MarketProducerService,
          useValue: { getSettings: () => ({ ...currentSettings }), start },
        },
      ],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('rejects out-of-range and fractional settings', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    const component = fixture.componentInstance;

    component.form.controls.instrumentCount.setValue(0);
    component.form.controls.updatesPerBatch.setValue(1000);
    component.form.controls.batchInterval.setValue(2001);

    expect(component.form.invalid).toBe(true);
    component.apply();
    expect(component.form.touched).toBe(true);
    expect(start).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    component.form.controls.instrumentCount.setValue(2.5);
    component.form.controls.updatesPerBatch.setValue(25.5);
    component.form.controls.batchInterval.setValue(750.5);

    expect(component.form.invalid).toBe(true);
    component.apply();
    expect(start).not.toHaveBeenCalled();
  });

  it('applies valid settings and navigates back to the dashboard', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    const component = fixture.componentInstance;
    const applied: ProducerSettings = {
      instrumentCount: 3,
      updatesPerBatch: 25,
      batchInterval: 750,
    };
    component.form.setValue(applied);

    component.apply();

    expect(start).toHaveBeenCalledWith(applied);
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('resets edited controls to the most recently applied settings', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    const component = fixture.componentInstance;
    const applied: ProducerSettings = {
      instrumentCount: 3,
      updatesPerBatch: 25,
      batchInterval: 750,
    };
    component.form.setValue(applied);

    component.apply();
    expect(start).toHaveBeenCalledWith(applied);

    component.form.setValue({
      instrumentCount: 1,
      updatesPerBatch: 1,
      batchInterval: 50,
    });

    component.reset();

    expect(component.form.getRawValue()).toEqual(applied);
    expect(component.form.valid).toBe(true);
    expect(start).toHaveBeenCalledOnce();
  });
});
