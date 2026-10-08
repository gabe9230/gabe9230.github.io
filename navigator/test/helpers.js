// Test helpers: an encoder for HERE's flexible polyline (the app only needs
// the decoder) and a fake fetch.

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeUnsigned(value) {
  let out = "";
  while (value > 0x1f) {
    out += ALPHABET[(value % 32) | 0x20];
    value = Math.floor(value / 32);
  }
  return out + ALPHABET[value];
}

const encodeSigned = (value) =>
  encodeUnsigned(value < 0 ? -2 * value - 1 : 2 * value);

export function encodeFlexiblePolyline(
  coords,
  { precision = 5, thirdDim = 0, thirdDimPrecision = 0 } = {},
) {
  const header = precision | (thirdDim << 4) | (thirdDimPrecision << 7);
  let out = encodeUnsigned(1) + encodeUnsigned(header);
  const factor = 10 ** precision;
  const factorZ = 10 ** thirdDimPrecision;
  let last = [0, 0, 0];
  for (const [lat, lng, z = 0] of coords) {
    const scaled = [
      Math.round(lat * factor),
      Math.round(lng * factor),
      Math.round(z * factorZ),
    ];
    out += encodeSigned(scaled[0] - last[0]) + encodeSigned(scaled[1] - last[1]);
    if (thirdDim) {
      out += encodeSigned(scaled[2] - last[2]);
    }
    last = scaled;
  }
  return out;
}

/**
 * A fetch that answers from a list of handlers, each matching on a URL
 * substring. Records every call.
 */
export function fakeFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    for (const [pattern, handler] of handlers) {
      if (String(url).includes(pattern)) {
        const result = await handler(String(url), init);
        if (result instanceof Response) {
          return result;
        }
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    throw new TypeError(`Unexpected request to ${url}`);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** Encodes [lat, lng] pairs as a Google polyline (for Valhalla fixtures). */
export function encodePolyline(coords, precision = 6) {
  const factor = 10 ** precision;
  let out = "";
  let last = [0, 0];
  const encodeValue = (value) => {
    let v = value < 0 ? -2 * value - 1 : 2 * value;
    let chunk = "";
    while (v >= 0x20) {
      chunk += String.fromCharCode(((v % 32) | 0x20) + 63);
      v = Math.floor(v / 32);
    }
    return chunk + String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of coords) {
    const scaled = [Math.round(lat * factor), Math.round(lng * factor)];
    out += encodeValue(scaled[0] - last[0]) + encodeValue(scaled[1] - last[1]);
    last = scaled;
  }
  return out;
}
