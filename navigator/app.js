/* global L */
import { findCandidates } from "./lib/candidates.js";
import { DEFAULT_PROVIDER, PROVIDERS } from "./lib/providers.js";
import { scoreRoutes } from "./lib/scoring.js";
import { mph } from "./lib/traffic.js";

const METERS_PER_MILE = 1609.344;
const PROVIDER_STORAGE = "navigator.trafficProvider";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

const $ = (id) => document.getElementById(id);

const state = {
  from: null, // { latlng: [lat, lng], label }
  to: null,
  routes: [], // Candidates, with traffic once checked.
  live: false, // Whether the routes were checked with live traffic.
  pinnedId: null, // A route the user picked; null follows the best route.
  trafficCallsSession: 0,
  busy: false,
};

// ---------------------------------------------------------------- Map

const map = L.map("map").setView([41.8781, -87.6298], 11);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map);

const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();

// Start the map at the device's location when the browser shares it;
// otherwise keep the default view.
if ("geolocation" in navigator) {
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const here = [coords.latitude, coords.longitude];
      L.circleMarker(here, {
        radius: 6,
        color: color("--accent"),
        weight: 3,
        fillColor: "#ffffff",
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
      // Don't move the map away from places or routes the user already has.
      if (!state.from && !state.to && state.routes.length === 0) {
        map.setView(here, 12);
      }
    },
    () => {
      // Denied or unavailable: keep the default view.
    },
    { timeout: 10000, maximumAge: 5 * 60 * 1000 },
  );
}

map.on("click", (event) => {
  const latlng = [event.latlng.lat, event.latlng.lng];
  const place = { latlng, label: formatLatLng(latlng) };
  if (!state.from) {
    setPlace("from", place);
  } else {
    setPlace("to", place);
  }
});

function drawMarkers() {
  markerLayer.clearLayers();
  for (const [which, fill] of [
    ["from", color("--free")],
    ["to", color("--accent")],
  ]) {
    const place = state[which];
    if (place) {
      L.circleMarker(place.latlng, {
        radius: 8,
        color: "#0d0d0d",
        weight: 2,
        fillColor: fill,
        fillOpacity: 1,
      })
        .bindTooltip(which === "from" ? "Start" : "Destination")
        .addTo(markerLayer);
    }
  }
}

// ---------------------------------------------------------- Places

function formatLatLng([lat, lng]) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function setPlace(which, place) {
  state[which] = place;
  $(which).value = place ? place.label : "";
  clearRoutes();
  drawMarkers();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastGeocode = 0;

/** Looks up an address. Nominatim allows one request per second. */
async function geocode(query) {
  const wait = 1100 - (Date.now() - lastGeocode);
  if (wait > 0) {
    await sleep(wait);
  }
  lastGeocode = Date.now();
  const bounds = map.getBounds();
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", query);
  // Prefer places near the current map view.
  url.searchParams.set(
    "viewbox",
    [
      bounds.getWest(),
      bounds.getNorth(),
      bounds.getEast(),
      bounds.getSouth(),
    ].join(","),
  );
  const response = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!response.ok) {
    throw new Error(`Address search failed (${response.status})`);
  }
  const [hit] = await response.json();
  if (!hit) {
    throw new Error(`No place found for "${query}"`);
  }
  return { latlng: [Number(hit.lat), Number(hit.lon)], label: hit.display_name };
}

/** Returns the place for an input, looking up typed addresses. */
async function resolvePlace(which) {
  const text = $(which).value.trim();
  if (state[which] && text === state[which].label) {
    return state[which];
  }
  if (!text) {
    throw new Error(
      which === "from"
        ? "Set a starting point: type an address or click the map."
        : "Set a destination: type an address or click the map.",
    );
  }
  const place = await geocode(text);
  state[which] = place;
  $(which).value = place.label;
  drawMarkers();
  return place;
}

for (const which of ["from", "to"]) {
  $(which).addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      search();
    }
  });
}

$("swap").addEventListener("click", () => {
  const { from, to } = state;
  state.from = to;
  state.to = from;
  [$("from").value, $("to").value] = [$("to").value, $("from").value];
  clearRoutes();
  drawMarkers();
});

$("clear").addEventListener("click", () => {
  setPlace("from", null);
  setPlace("to", null);
  setStatus("");
});

// ------------------------------------------------------------ Knobs

function bindRange(id, format) {
  const input = $(id);
  const output = $(`${id}-value`);
  const update = () => {
    output.value = format(Number(input.value));
  };
  input.addEventListener("input", () => {
    update();
    render(false);
  });
  update();
}

bindRange("x", (v) => v.toFixed(2));
bindRange("y", (v) => v.toFixed(2));
bindRange("limit", (v) => String(v));

// -------------------------------------------------------------- Key

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // Storage is blocked.
  }
}

function writeStorage(key, value) {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Storage is blocked; the key lasts until the page is closed.
  }
}

function currentProvider() {
  return PROVIDERS[$("provider").value] ?? PROVIDERS[DEFAULT_PROVIDER];
}

/** The user's own key if they entered one, otherwise the site's key. */
function activeKey() {
  return $("key").value.trim() || currentProvider().builtInKey?.() || "";
}

function updateKeyState() {
  const provider = currentProvider();
  const ownKey = $("key").value.trim();
  $("key-state").textContent = ownKey
    ? `(on: your ${provider.name} key)`
    : provider.builtInKey
      ? `(on: ${provider.name})`
      : "(off: no key)";
  $("provider-note").textContent = provider.note;
  $("provider-link").href = provider.signupUrl;
  $("provider-link").textContent = new URL(provider.signupUrl).host;
  $("key").placeholder = provider.builtInKey
    ? `Optional: your own ${provider.name} key`
    : `${provider.name} API key`;
}

function loadProvider(id) {
  $("provider").value = PROVIDERS[id] ? id : DEFAULT_PROVIDER;
  $("key").value = readStorage(currentProvider().keyStorage) ?? "";
  updateKeyState();
}

$("provider").addEventListener("change", () => {
  writeStorage(PROVIDER_STORAGE, $("provider").value);
  loadProvider($("provider").value);
});
$("key").addEventListener("change", () => {
  writeStorage(currentProvider().keyStorage, $("key").value.trim());
  updateKeyState();
});
loadProvider(readStorage(PROVIDER_STORAGE) ?? DEFAULT_PROVIDER);

// ----------------------------------------------------------- Search

function setStatus(text, isError = false) {
  const status = $("status");
  status.textContent = text;
  status.classList.toggle("error", isError);
}

function setBusy(busy) {
  state.busy = busy;
  $("go").disabled = busy;
  $("go").textContent = busy ? "Working..." : "Find routes";
}

function clearRoutes() {
  state.routes = [];
  state.pinnedId = null;
  render(false);
}

/** Runs `fn` over `items` with at most `limit` at a time, keeping order. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * When the provider skipped the ends of a route, adds the router's own
 * (traffic-free) estimate for those ends to the travel times.
 */
function withTrimmedEnds(traffic, candidate) {
  const trimmedM = traffic.trimmedM ?? 0;
  if (trimmedM <= 0) {
    return { ...traffic, trim: [0, 0], trimmedM: 0 };
  }
  const extraS = (candidate.durationS * trimmedM) / candidate.lengthM;
  return {
    ...traffic,
    trimmedM,
    durationS: traffic.durationS + extraS,
    typicalDurationS:
      traffic.typicalDurationS == null ? null : traffic.typicalDurationS + extraS,
    baseDurationS: traffic.baseDurationS + extraS,
  };
}

async function search() {
  if (state.busy) {
    return;
  }
  setBusy(true);
  try {
    setStatus("Finding places...");
    const from = await resolvePlace("from");
    const to = await resolvePlace("to");

    setStatus("Finding candidate routes...");
    const { candidates, errors } = await findCandidates(from.latlng, to.latlng, {
      limit: Number($("limit").value),
    });

    const provider = currentProvider();
    const key = activeKey();
    let routes = null;
    let trafficCalls = 0;
    let trafficProblem = null;
    if (key) {
      setStatus(
        `Checking live traffic on ${candidates.length} routes with ${provider.name}...`,
      );
      // Counts every request, and waits and retries when rate limited.
      const trafficFetch = async (url, init) => {
        for (let attempt = 0; ; attempt++) {
          trafficCalls += 1;
          state.trafficCallsSession += 1;
          const response = await fetch(url, init);
          if (response.status !== 429 || attempt >= 2) {
            return response;
          }
          await sleep(1000 * (attempt + 1));
        }
      };
      // Routes between the same places usually need the same ends skipped.
      let trimHint = null;
      const checked = await mapLimit(candidates, 2, async (candidate) => {
        try {
          const result = await provider.checkRoute(
            candidate.coords,
            key,
            trafficFetch,
            { trimHint },
          );
          if (result.trimmedM > 0) {
            trimHint = result.trim;
          }
          const traffic = withTrimmedEnds(result, candidate);
          // Trip length (q) comes from our own route; the provider's copy
          // of it can differ slightly where its map differs.
          const mismatch =
            Math.abs(traffic.lengthM + traffic.trimmedM - candidate.lengthM) /
            candidate.lengthM;
          const notes = [];
          if (traffic.approximate || mismatch > 0.15) {
            notes.push(
              `${provider.name} could only roughly follow this route ` +
                `(${miles(traffic.lengthM)} mi instead of ` +
                `${miles(candidate.lengthM)} mi); treat its traffic numbers with caution.`,
            );
          } else if (traffic.trimmedM > 0) {
            const [startM, endM] = traffic.trim;
            const where =
              startM > 0 && endM > 0 ? "start and end" : startM > 0 ? "start" : "end";
            notes.push(
              `Live traffic covers all but ${miles(traffic.trimmedM)} mi at the ` +
                `${where}, where ${provider.name} has no matching roads.`,
            );
          }
          return {
            ...candidate,
            traffic,
            durationS: traffic.durationS,
            avgSpeed: traffic.avgSpeed,
            matchWarning: notes[0] ?? null,
          };
        } catch (err) {
          return { ...candidate, avgSpeed: null, error: err.message };
        }
      });
      if (checked.some((route) => route.traffic)) {
        routes = checked;
        state.live = true;
      } else {
        trafficProblem =
          checked[0]?.error ?? `${provider.name} did not return traffic`;
      }
    }
    if (!routes) {
      // Without traffic, compare the routers' own traffic-free speeds.
      routes = candidates.map((candidate) => ({
        ...candidate,
        avgSpeed: candidate.lengthM / candidate.durationS,
      }));
      state.live = false;
    }
    state.routes = routes;
    state.pinnedId = null;
    render(true);

    const parts = [
      `${routes.length} routes compared ${
        state.live ? "with live traffic" : "without traffic"
      }.`,
    ];
    if (key) {
      parts.push(
        `${provider.name} calls: ${trafficCalls} (this session: ${state.trafficCallsSession}).`,
      );
    }
    const sentence = (text) => text.replace(/\.+$/, "");
    if (trafficProblem) {
      parts.push(`Live traffic unavailable: ${sentence(trafficProblem)}.`);
    }
    if (errors.length) {
      parts.push(`Some routers failed: ${sentence(errors.join("; "))}.`);
    }
    setStatus(parts.join(" "), Boolean(trafficProblem));
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    setBusy(false);
  }
}

$("go").addEventListener("click", search);

// ----------------------------------------------------------- Render

const miles = (meters) => (meters / METERS_PER_MILE).toFixed(1);
const minutes = (seconds) => Math.round(seconds / 60);

function levelColor(level) {
  return (
    { free: color("--free"), slow: color("--slow"), jam: color("--jam") }[level] ??
    color("--accent")
  );
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text != null) {
    node.textContent = text;
  }
  return node;
}

function render(fitMap) {
  const knobs = { x: Number($("x").value), y: Number($("y").value) };
  const scored = scoreRoutes(state.routes, knobs);
  const failed = state.routes.filter((route) => route.error);
  const selected =
    scored.find((route) => route.id === state.pinnedId) ?? scored[0] ?? null;
  renderList(scored, failed, selected);
  renderMap(scored, selected, fitMap);
}

function renderList(scored, failed, selected) {
  const list = $("results");
  list.replaceChildren();
  scored.forEach((route, index) => {
    const item = element("li", "result");
    item.classList.toggle("best", index === 0);
    item.classList.toggle("selected", route === selected);
    item.addEventListener("click", () => {
      state.pinnedId = index === 0 ? null : route.id;
      render(false);
    });

    const head = element("div", "result-head");
    head.append(
      element("span", null, `#${index + 1} ${route.label}`),
      element("span", "score", `score ${route.score.toFixed(2)}`),
    );

    const body = element("div", "result-body");
    const lines = [];
    if (route.traffic) {
      const t = route.traffic;
      lines.push(
        `${miles(route.lengthM)} mi · average road speed ${mph(route.avgSpeed)} mph` +
          (t.avgFreeFlowSpeed
            ? ` (${mph(t.avgFreeFlowSpeed)} mph without traffic)`
            : ""),
      );
      lines.push(
        `${minutes(t.durationS)} min now` +
          (t.typicalDurationS != null
            ? ` · ${minutes(t.typicalDurationS)} min typical`
            : "") +
          ` · ${minutes(t.baseDurationS)} min with no traffic`,
      );
      if (t.jamShare > 0) {
        lines.push(`${Math.max(1, Math.round(t.jamShare * 100))}% of the route is jammed`);
      }
    } else {
      lines.push(
        `${miles(route.lengthM)} mi · average road speed ${mph(route.avgSpeed)} mph` +
          ` · about ${minutes(route.durationS)} min, traffic not included`,
      );
    }
    for (const line of lines) {
      body.append(element("div", null, line));
    }
    body.append(
      element(
        "div",
        "terms",
        `q ${route.q.toFixed(2)} × x + k ${route.k.toFixed(2)} × y`,
      ),
    );
    if (route.matchWarning) {
      body.append(element("div", "warning", route.matchWarning));
    }
    if (route.alsoFoundBy?.length) {
      body.append(element("div", null, `Same roads as: ${route.alsoFoundBy.join(", ")}`));
    }
    item.append(head, body);
    list.append(item);
  });

  for (const route of failed) {
    const item = element("li", "result failed");
    item.append(
      element("div", "result-head", route.label),
      element("div", "result-body", `Not scored: ${route.error}`),
    );
    list.append(item);
  }
}

function renderMap(scored, selected, fitMap) {
  routeLayer.clearLayers();
  for (const route of scored) {
    if (route === selected) {
      continue;
    }
    L.polyline(route.coords, {
      color: "#8a8a8a",
      weight: 5,
      opacity: 0.6,
    })
      .on("click", () => {
        state.pinnedId = route === scored[0] ? null : route.id;
        render(false);
      })
      .bindTooltip(route.label, { sticky: true })
      .addTo(routeLayer);
  }
  if (selected) {
    L.polyline(selected.coords, { color: "#000", weight: 11, opacity: 0.55 }).addTo(
      routeLayer,
    );
    if (selected.traffic) {
      for (const segment of selected.traffic.segments) {
        if (segment.coords.length >= 2) {
          L.polyline(segment.coords, {
            color: levelColor(segment.level),
            weight: 7,
            opacity: 1,
          })
            .bindTooltip(segment.note, { sticky: true })
            .addTo(routeLayer);
        }
      }
    } else {
      L.polyline(selected.coords, {
        color: color("--accent"),
        weight: 7,
        opacity: 1,
      }).addTo(routeLayer);
    }
  }
  if (fitMap && scored.length) {
    const bounds = L.latLngBounds(scored.flatMap((route) => route.coords));
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

render(false);
