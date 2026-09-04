export function resolveRequestedVersion(gameId, manifest = {}, requested = null) {
  if (requested === "home") return null
  if (requested === "latest") return manifest[gameId]?.latest ?? null
  if (requested === "live") return manifest[gameId]?.live ?? null
  if (!requested) {
    const entry = manifest[gameId]
    const latest = entry?.latest
    const available = entry?.available
    return latest && (!Array.isArray(available) || available.length === 0 || available.includes(latest))
      ? latest
      : null
  }
  const available = manifest[gameId]?.available
  if (Array.isArray(available) && available.length > 0 && !available.includes(requested)) {
    console.warn(`  ! ${gameId}: ${requested} is not listed in manifest.available; trying it anyway.`)
  }
  return requested
}
