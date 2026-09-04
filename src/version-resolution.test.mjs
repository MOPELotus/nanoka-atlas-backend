import assert from "node:assert/strict"
import { resolveRequestedVersion } from "./version-resolution.mjs"

const manifest = {
  zzz: { latest: "3.0.4", live: "3.0.3", available: ["3.0.4", "3.0.3"] },
  hsr: { latest: "4.3.51", live: "4.3.50", available: ["4.3.50"] },
}

assert.equal(resolveRequestedVersion("zzz", manifest), "3.0.4")
assert.equal(resolveRequestedVersion("zzz", manifest, "latest"), "3.0.4")
assert.equal(resolveRequestedVersion("zzz", manifest, "live"), "3.0.3")
assert.equal(resolveRequestedVersion("zzz", manifest, "home"), null)
assert.equal(resolveRequestedVersion("zzz", manifest, "3.0.3"), "3.0.3")
assert.equal(resolveRequestedVersion("hsr", manifest), null)
assert.equal(resolveRequestedVersion("unknown", manifest), null)

console.log("nanoka version-resolution self-check ok")
