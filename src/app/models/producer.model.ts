export interface ProducerSettings {
  instrumentCount: number;
  updatesPerBatch: number;
  batchInterval: number;
}

export const INSTRUMENT_NAMES = ['ALFA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON'] as const;

export type ProducerStatus = 'idle' | 'starting' | 'running' | 'paused' | 'error';
