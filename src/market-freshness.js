// “Delayed” means the source timestamp is over one hour old; it is not a price guarantee.
export function navFreshness(item, now = Date.now()) {
  const price = Number(String(item?.price ?? "").replace(/[$,]/g, ""));
  if (item?.dataQuality?.nav === false || !Number.isFinite(price) || price <= 0) return "unavailable";
  const timestamp = Date.parse(item?.navUpdatedAt || "");
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60e3) return "unknown";
  return now - timestamp > 60 * 60e3 ? "delayed" : "current";
}
