export function listFailedRomCertifications(certifications) {
  return Object.entries(certifications)
    .filter(([, certified]) => certified !== true)
    .map(([name]) => name)
    .sort()
}
