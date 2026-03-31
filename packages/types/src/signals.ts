// ── Signal Entity Types ──

export type SignalEntityType = 'company' | 'person';
export type SignalSource = 'arxiv' | 'twitter' | 'opencorporates' | 'manual';
export type SignalType = 'paper' | 'hiring' | 'funding' | 'corp_filing' | 'social_mention';

export interface SignalEntity {
  id: string;
  entityType: SignalEntityType;
  name: string;
  aliases: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SignalEvent {
  id?: string;
  entityId?: string;
  entityName?: string;
  source: SignalSource;
  signalType: SignalType;
  rawData: Record<string, unknown>;
  confidence: number;
  observedAt: string;
  createdAt?: string;
}

export interface SignalConvergence {
  id: string;
  entityId: string;
  signalEventIds: string[];
  convergenceScore: number;
  windowStart: string;
  windowEnd: string;
  postedToSourcing: boolean;
  createdAt: string;
}

export interface WatchlistEntry {
  name: string;
  type: SignalEntityType;
  aliases?: string[];
  metadata?: Record<string, unknown>;
}
