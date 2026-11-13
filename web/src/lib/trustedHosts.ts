// Trusted organizers for the reputation score (SPEC H3): their settled events
// count four times as much, but only events created while they were trusted.
// Public on purpose: anyone can recompute every score from the chain and this
// list. Dates are milliseconds since the Unix epoch; leave `to` out while trusted.
import type { TrustedHost } from "./reputationShared.ts";

export const TRUSTED_HOSTS: TrustedHost[] = [];
