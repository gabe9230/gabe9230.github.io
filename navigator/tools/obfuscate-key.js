// Prints the line for key.js from a TomTom API key.
// Usage: node tools/obfuscate-key.js <api key>

import { obfuscate } from "../lib/obfuscate.js";

const key = process.argv[2];
if (!key) {
  console.error("Usage: node tools/obfuscate-key.js <api key>");
  process.exit(1);
}
console.log(`export const BUILT_IN_TOMTOM_KEY = "${obfuscate(key)}";`);
