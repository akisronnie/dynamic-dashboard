import { MarketUpdate } from './market-update.model';

export interface StartCommand {
  type: 'start';
  runId: number;
  instrumentCount: number;
  updatesPerBatch: number;
  batchInterval: number;
}

export interface PauseCommand {
  type: 'pause';
  runId: number;
}

export interface ResumeCommand {
  type: 'resume';
  runId: number;
}

export type ProducerCommand = StartCommand | PauseCommand | ResumeCommand;

export interface ReadyMessage {
  type: 'ready';
  runId: number;
}

export interface BatchMessage {
  type: 'batch';
  runId: number;
  updates: MarketUpdate[];
}

export interface PausedMessage {
  type: 'paused';
  runId: number;
}

export interface ResumedMessage {
  type: 'resumed';
  runId: number;
}

export interface ErrorMessage {
  type: 'error';
  runId: number;
  message: string;
}

export type ProducerMessage =
  ReadyMessage | BatchMessage | PausedMessage | ResumedMessage | ErrorMessage;
