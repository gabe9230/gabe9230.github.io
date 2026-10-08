// Decoder for HERE's Flexible Polyline format, which HERE Routing API v8 uses
// for route geometry. Format specification:
// https://github.com/heremaps/flexible-polyline

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VALUES = new Map([...ALPHABET].map((char, value) => [char, value]));
const FORMAT_VERSION = 1;

/** Decodes the string into unsigned integers, 5 bits per character. */
function decodeUnsignedValues(encoded) {
  const values = [];
  let result = 0;
  let shift = 0;
  for (const char of encoded) {
    const value = VALUES.get(char);
    if (value === undefined) {
      throw new Error(`Invalid flexible polyline character "${char}"`);
    }
    // Plain arithmetic instead of bit operators: values can exceed 32 bits.
    result += (value & 0x1f) * 2 ** shift;
    if ((value & 0x20) === 0) {
      values.push(result);
      result = 0;
      shift = 0;
    } else {
      shift += 5;
    }
  }
  if (shift > 0) {
    throw new Error("Invalid flexible polyline: truncated value");
  }
  return values;
}

/** Undoes the zigzag encoding of signed values. */
function toSigned(value) {
  return value % 2 === 1 ? -(value + 1) / 2 : value / 2;
}

/**
 * Decodes a flexible polyline into [lat, lng] pairs
 * (or [lat, lng, z] triples when it has a third dimension).
 */
export function decodeFlexiblePolyline(encoded) {
  const values = decodeUnsignedValues(encoded);
  if (values.length < 2 || values[0] !== FORMAT_VERSION) {
    throw new Error("Unsupported flexible polyline format version");
  }
  const header = values[1];
  const precision = header & 15;
  const thirdDim = (header >> 4) & 7;
  const thirdDimPrecision = (header >> 7) & 15;
  const factor = 10 ** precision;
  const factorZ = 10 ** thirdDimPrecision;
  const stride = thirdDim ? 3 : 2;
  if ((values.length - 2) % stride !== 0) {
    throw new Error("Invalid flexible polyline: incomplete coordinate");
  }
  const coords = [];
  let lat = 0;
  let lng = 0;
  let z = 0;
  for (let i = 2; i < values.length; i += stride) {
    lat += toSigned(values[i]);
    lng += toSigned(values[i + 1]);
    if (thirdDim) {
      z += toSigned(values[i + 2]);
      coords.push([lat / factor, lng / factor, z / factorZ]);
    } else {
      coords.push([lat / factor, lng / factor]);
    }
  }
  return coords;
}
