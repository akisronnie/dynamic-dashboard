export interface InstrumentMetrics {
  instrument: string;

  /**
   * Last traded price in integer cents.
   * null = no trade received yet.
   */
  lastPriceCents: number | null;

  /**
   * Ask - Bid in cents.
   * null = order book data unavailable.
   */
  spreadCents: number | null;

  /**
   * Cumulative traded quantity since the current run.
   */
  volume: number;

  /**
   * Cumulative sum(price * quantity).
   * Kept in cents * quantity so VWAP can be calculated exactly.
   */
  turnoverCents: number;

  /**
   * Cumulative VWAP in cents.
   * null = no trades yet.
   */
  vwapCents: number | null;

  /**
   * (bidQuantity - askQuantity) /
   * (bidQuantity + askQuantity)
   *
   * null = both quantities are zero.
   */
  imbalance: number | null;
}

export interface MarketUpdate {
  instrument: string;
  priceCents: number;
  tradeQuantity: number;
  bidCents: number;
  askCents: number;
  bidQuantity: number;
  askQuantity: number;
}
