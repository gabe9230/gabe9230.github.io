// Shared shape of a traffic check, whichever provider produced it:
//
// {
//   provider:          "tomtom" | "here",
//   lengthM:           route length in meters,
//   durationS:         travel time now, with live traffic,
//   typicalDurationS:  usual travel time at this time of day (or null),
//   baseDurationS:     travel time with no traffic,
//   avgSpeed:          length-weighted mean of per-road speeds, m/s,
//   jamShare:          fraction of the route's length that is jammed,
//   segments:          [{ coords, level, note }] to draw, later ones on top;
//                      level is "free", "slow", "jam" or "unknown".
// }

export class TrafficError extends Error {
  constructor(provider, status, message) {
    super(message);
    this.name = "TrafficError";
    this.provider = provider;
    this.status = status;
  }
}

/** Congestion level from current speed relative to free-flow speed. */
export function levelForRatio(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) {
    return "unknown";
  }
  if (ratio >= 0.75) {
    return "free";
  }
  return ratio >= 0.5 ? "slow" : "jam";
}

const MPS_TO_MPH = 2.23694;

export const mph = (metersPerSecond) => Math.round(metersPerSecond * MPS_TO_MPH);
