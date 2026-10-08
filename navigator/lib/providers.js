// Live traffic providers. Each one checks a route given as [lat, lng]
// points and returns the shared shape described in traffic.js.

import { BUILT_IN_TOMTOM_KEY } from "../key.js";
import * as here from "./here.js";
import { deobfuscate } from "./obfuscate.js";
import * as tomtom from "./tomtom.js";

export const PROVIDERS = {
  tomtom: {
    id: "tomtom",
    name: "TomTom",
    keyStorage: "navigator.tomtomApiKey",
    signupUrl: "https://developer.tomtom.com/",
    note: "Works out of the box with this site's own key. You can use your own key instead (free, no credit card).",
    builtInKey: () => deobfuscate(BUILT_IN_TOMTOM_KEY),
    checkRoute: tomtom.checkRoute,
  },
  here: {
    id: "here",
    name: "HERE",
    keyStorage: "navigator.hereApiKey",
    signupUrl: "https://platform.here.com/",
    note: "Needs your own key. HERE has a free tier, but asks for a credit card.",
    builtInKey: null,
    checkRoute: here.checkRoute,
  },
};

export const DEFAULT_PROVIDER = "tomtom";
