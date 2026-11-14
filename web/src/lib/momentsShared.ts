// Moments: photos people share from a past event. Shared by the browser and the API.

export interface Moment {
  /** sha256 of the JPEG (the cover id), so the same photo is kept once per event. */
  id: string;
  /** `/api/covers/<id>`; a data: URL in the demo. */
  url: string;
  by: string;
  at: number;
}

export const MAX_MOMENTS = 300;

/** Why this account can't add photos to the event, or null when it can. */
export function momentProblem(o: { ended: boolean; host: boolean; guest: boolean }): string | null {
  if (!o.host && !o.guest) return "Only the event's guests and hosts can add photos";
  if (!o.ended) return "Photos open once the event ends";
  return null;
}

/** The person who added a photo can remove it; the host and door team can remove any. */
export const mayRemove = (m: Pick<Moment, "by">, account: string, host: boolean) => host || m.by === account;
