// Reversible obfuscation for the built-in API key. This is NOT encryption:
// anyone can undo it, and the key is visible in the requests the page sends.
// It only keeps the key out of plain-text searches of the repository.

const PAD = "gabrielhalloran.org/navigator";

const xor = (bytes) =>
  bytes.map((byte, i) => byte ^ PAD.charCodeAt(i % PAD.length));

export function obfuscate(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const binary = String.fromCharCode(...xor(bytes));
  return [...btoa(binary)].reverse().join("");
}

export function deobfuscate(encoded) {
  const binary = atob([...encoded].reverse().join(""));
  const bytes = xor([...binary].map((char) => char.charCodeAt(0)));
  return new TextDecoder().decode(new Uint8Array(bytes));
}
