# Realtime Markets — Dynamic Dashboard

Realtime Markets is a web dashboard for monitoring a stream of synthetic market data. It generates market updates with WebAssembly, processes them in a Web Worker, and displays aggregated metrics for each instrument in real time.

> This application uses **simulated data**. It does not connect to an exchange or any external market-data provider.

**Live demo:** [akisronnie.github.io/dynamic-dashboard/dashboard](https://akisronnie.github.io/dynamic-dashboard/dashboard)  
**Repository:** [github.com/akisronnie/dynamic-dashboard](https://github.com/akisronnie/dynamic-dashboard)

## Features

- Instrument table with last traded price, spread, cumulative volume, VWAP, and order-book imbalance.
- Session summary with instrument count, total volume, and overall VWAP.
- Producer controls to start, pause, and resume the data stream.
- Configurable instrument count, updates per batch, and batch interval.
- Incremental metric aggregation without retaining the full trade history.

Starting a producer run resets the metrics for the current session. Prices and spreads are displayed in dollars. Volume and VWAP include all trades generated during the current run.

## Tech stack

- Angular 22, TypeScript, and RxJS
- PrimeNG
- Web Workers for background processing
- AssemblyScript and WebAssembly for market-data generation
- ESLint and Vitest

## Requirements

- Node.js 22 or later
- npm

## Getting started

Install the project dependencies and build the WebAssembly module:

```bash
npm ci
npm run build:wasm
```

Start the development server:

```bash
npm start
```

Open the URL printed by the Angular CLI (usually [http://localhost:4200](http://localhost:4200)). The development server reloads the application when source files change.

Build the WASM module before the first run after cloning the repository. The command creates `wasm/build/release.wasm`, which is used by the Angular application.

## Producer settings

The **Settings** page lets you configure the data stream:

| Setting | Default | Allowed range |
| --- | ---: | ---: |
| Instrument count | 5 | 1–50 |
| Updates per batch | 100 | 1–1000 |
| Batch interval | 500 ms | 50–2000 ms |

Settings take effect when you select **Apply & Start**. Instruments are named `ALFA`, `BETA`, `GAMMA`, `DELTA`, `EPSILON`, followed by `INSTRUMENT_6` and higher for additional instruments.

## Available commands

| Command | Description |
| --- | --- |
| `npm start` | Start the Angular development server |
| `npm run build:wasm` | Build the release WebAssembly module |
| `npm run build` | Build the Angular application |
| `npm test` | Run the Angular unit tests |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Automatically fix supported ESLint issues |
| `npm run format` | Format files with Prettier |
| `npm run format:check` | Check formatting with Prettier |
| `npm run watch` | Build in development mode and watch for changes |

To create a production build, build WASM first and then build the Angular application:

```bash
npm run build:wasm
npm run build
```

The Angular build output is written to `dist/dynamic-dashboard/browser/`.

## Project structure

```text
src/app/
├── core/
│   ├── models/       # Market update and metrics models
│   ├── services/     # Producer state and metric aggregation
│   └── workers/      # Web Worker and WASM integration
├── features/
│   ├── dashboard/    # Market overview and metrics table
│   └── settings/     # Producer configuration
└── shared/           # Shared validators

wasm/
└── assembly/         # AssemblyScript market-data generator
```

## Deployment

The GitHub Actions workflow in `.github/workflows/deploy.yml` deploys the application to GitHub Pages on pushes to `main` or when manually triggered. It installs dependencies, runs lint and tests, builds the WASM module, and builds Angular with the `/dynamic-dashboard/` base path.
