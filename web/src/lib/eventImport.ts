export interface ImportedEvent {
  title: string;
  starts_at: number;
  ends_at: number;
  location: string;
  description: string;
  cover_url: string | null;
}

/** Public fields saved by Near Me outside the escrow contract. */
export interface EventDetails {
  location: string;
  description: string;
  cover_url: string | null;
}
