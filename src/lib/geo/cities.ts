/**
 * LOC-002 — city centroids, for radius arithmetic.
 *
 * FSD v1.1 §39.2 D-2 records that radius matching needs coordinates, and that a
 * commercial geocoder adds cost, a dependency and a data-protection question,
 * because coordinates are more precise than anything else we hold about a
 * candidate. This table is the answer for now: a bundled set of centroids for
 * the metros that carry the overwhelming majority of postings.
 *
 * The deliberate consequence is that radius matching DEGRADES rather than
 * fails. When either side's city is absent from this table, `distanceMiles`
 * returns null and the eligibility layer falls back to exact city/state
 * equality (see eligibility.ts). A missing centroid must never mean "eligible".
 *
 * Coordinates are city centroids to roughly two decimal places, which is about
 * a kilometre — far coarser than a street address, and coarse on purpose. We
 * never store or derive a candidate's precise position.
 */

export type LatLng = { lat: number; lng: number };

/** Key format: "city|region|country", all lower-cased. Region is "" if unknown. */
const CENTROIDS: Record<string, LatLng> = {
  // ── United States ──
  "new york|ny|us": { lat: 40.71, lng: -74.01 },
  "brooklyn|ny|us": { lat: 40.68, lng: -73.94 },
  "jersey city|nj|us": { lat: 40.73, lng: -74.06 },
  "newark|nj|us": { lat: 40.74, lng: -74.17 },
  "boston|ma|us": { lat: 42.36, lng: -71.06 },
  "cambridge|ma|us": { lat: 42.37, lng: -71.11 },
  "philadelphia|pa|us": { lat: 39.95, lng: -75.17 },
  "pittsburgh|pa|us": { lat: 40.44, lng: -79.996 },
  "washington|dc|us": { lat: 38.91, lng: -77.04 },
  "arlington|va|us": { lat: 38.88, lng: -77.1 },
  "baltimore|md|us": { lat: 39.29, lng: -76.61 },
  "richmond|va|us": { lat: 37.54, lng: -77.44 },
  "charlotte|nc|us": { lat: 35.23, lng: -80.84 },
  "raleigh|nc|us": { lat: 35.78, lng: -78.64 },
  "durham|nc|us": { lat: 35.99, lng: -78.9 },
  "atlanta|ga|us": { lat: 33.75, lng: -84.39 },
  "miami|fl|us": { lat: 25.76, lng: -80.19 },
  "orlando|fl|us": { lat: 28.54, lng: -81.38 },
  "tampa|fl|us": { lat: 27.95, lng: -82.46 },
  "jacksonville|fl|us": { lat: 30.33, lng: -81.66 },
  "nashville|tn|us": { lat: 36.16, lng: -86.78 },
  "memphis|tn|us": { lat: 35.15, lng: -90.05 },
  "new orleans|la|us": { lat: 29.95, lng: -90.07 },
  "houston|tx|us": { lat: 29.76, lng: -95.37 },
  "dallas|tx|us": { lat: 32.78, lng: -96.8 },
  "fort worth|tx|us": { lat: 32.76, lng: -97.33 },
  "plano|tx|us": { lat: 33.02, lng: -96.7 },
  "irving|tx|us": { lat: 32.81, lng: -96.95 },
  "arlington|tx|us": { lat: 32.74, lng: -97.11 },
  "austin|tx|us": { lat: 30.27, lng: -97.74 },
  "san antonio|tx|us": { lat: 29.42, lng: -98.49 },
  "oklahoma city|ok|us": { lat: 35.47, lng: -97.52 },
  "kansas city|mo|us": { lat: 39.1, lng: -94.58 },
  "st louis|mo|us": { lat: 38.63, lng: -90.2 },
  "chicago|il|us": { lat: 41.88, lng: -87.63 },
  "detroit|mi|us": { lat: 42.33, lng: -83.05 },
  "columbus|oh|us": { lat: 39.96, lng: -83.0 },
  "cleveland|oh|us": { lat: 41.5, lng: -81.69 },
  "cincinnati|oh|us": { lat: 39.1, lng: -84.51 },
  "indianapolis|in|us": { lat: 39.77, lng: -86.16 },
  "milwaukee|wi|us": { lat: 43.04, lng: -87.91 },
  "minneapolis|mn|us": { lat: 44.98, lng: -93.27 },
  "denver|co|us": { lat: 39.74, lng: -104.99 },
  "boulder|co|us": { lat: 40.01, lng: -105.27 },
  "salt lake city|ut|us": { lat: 40.76, lng: -111.89 },
  "phoenix|az|us": { lat: 33.45, lng: -112.07 },
  "tucson|az|us": { lat: 32.22, lng: -110.97 },
  "las vegas|nv|us": { lat: 36.17, lng: -115.14 },
  "albuquerque|nm|us": { lat: 35.08, lng: -106.65 },
  "san francisco|ca|us": { lat: 37.77, lng: -122.42 },
  "oakland|ca|us": { lat: 37.8, lng: -122.27 },
  "san jose|ca|us": { lat: 37.34, lng: -121.89 },
  "palo alto|ca|us": { lat: 37.44, lng: -122.14 },
  "mountain view|ca|us": { lat: 37.39, lng: -122.08 },
  "sunnyvale|ca|us": { lat: 37.37, lng: -122.04 },
  "los angeles|ca|us": { lat: 34.05, lng: -118.24 },
  "santa monica|ca|us": { lat: 34.02, lng: -118.49 },
  "irvine|ca|us": { lat: 33.68, lng: -117.83 },
  "san diego|ca|us": { lat: 32.72, lng: -117.16 },
  "sacramento|ca|us": { lat: 38.58, lng: -121.49 },
  "portland|or|us": { lat: 45.52, lng: -122.68 },
  "seattle|wa|us": { lat: 47.61, lng: -122.33 },
  "bellevue|wa|us": { lat: 47.61, lng: -122.2 },
  "honolulu|hi|us": { lat: 21.31, lng: -157.86 },
  "anchorage|ak|us": { lat: 61.22, lng: -149.9 },

  // ── Canada ──
  "toronto|on|ca": { lat: 43.65, lng: -79.38 },
  "ottawa|on|ca": { lat: 45.42, lng: -75.7 },
  "montreal|qc|ca": { lat: 45.5, lng: -73.57 },
  "vancouver|bc|ca": { lat: 49.28, lng: -123.12 },
  "calgary|ab|ca": { lat: 51.05, lng: -114.07 },
  "edmonton|ab|ca": { lat: 53.55, lng: -113.49 },
  "waterloo|on|ca": { lat: 43.46, lng: -80.52 },

  // ── United Kingdom & Ireland ──
  "london||gb": { lat: 51.51, lng: -0.13 },
  "manchester||gb": { lat: 53.48, lng: -2.24 },
  "birmingham||gb": { lat: 52.49, lng: -1.89 },
  "edinburgh||gb": { lat: 55.95, lng: -3.19 },
  "glasgow||gb": { lat: 55.86, lng: -4.25 },
  "bristol||gb": { lat: 51.45, lng: -2.59 },
  "leeds||gb": { lat: 53.8, lng: -1.55 },
  "cambridge||gb": { lat: 52.21, lng: 0.12 },
  "dublin||ie": { lat: 53.35, lng: -6.26 },

  // ── Europe ──
  "berlin||de": { lat: 52.52, lng: 13.4 },
  "munich||de": { lat: 48.14, lng: 11.58 },
  "hamburg||de": { lat: 53.55, lng: 9.99 },
  "frankfurt||de": { lat: 50.11, lng: 8.68 },
  "paris||fr": { lat: 48.86, lng: 2.35 },
  "amsterdam||nl": { lat: 52.37, lng: 4.9 },
  "brussels||be": { lat: 50.85, lng: 4.35 },
  "zurich||ch": { lat: 47.38, lng: 8.54 },
  "vienna||at": { lat: 48.21, lng: 16.37 },
  "madrid||es": { lat: 40.42, lng: -3.7 },
  "barcelona||es": { lat: 41.39, lng: 2.17 },
  "lisbon||pt": { lat: 38.72, lng: -9.14 },
  "milan||it": { lat: 45.46, lng: 9.19 },
  "rome||it": { lat: 41.9, lng: 12.5 },
  "stockholm||se": { lat: 59.33, lng: 18.07 },
  "oslo||no": { lat: 59.91, lng: 10.75 },
  "copenhagen||dk": { lat: 55.68, lng: 12.57 },
  "helsinki||fi": { lat: 60.17, lng: 24.94 },
  "warsaw||pl": { lat: 52.23, lng: 21.01 },
  "krakow||pl": { lat: 50.06, lng: 19.94 },
  "prague||cz": { lat: 50.08, lng: 14.44 },
  "bucharest||ro": { lat: 44.43, lng: 26.1 },
  "athens||gr": { lat: 37.98, lng: 23.73 },

  // ── Asia-Pacific ──
  "bengaluru||in": { lat: 12.97, lng: 77.59 },
  "bangalore||in": { lat: 12.97, lng: 77.59 },
  "hyderabad||in": { lat: 17.39, lng: 78.49 },
  "chennai||in": { lat: 13.08, lng: 80.27 },
  "mumbai||in": { lat: 19.08, lng: 72.88 },
  "pune||in": { lat: 18.52, lng: 73.86 },
  "delhi||in": { lat: 28.61, lng: 77.21 },
  "new delhi||in": { lat: 28.61, lng: 77.21 },
  "gurugram||in": { lat: 28.46, lng: 77.03 },
  "noida||in": { lat: 28.54, lng: 77.39 },
  "kolkata||in": { lat: 22.57, lng: 88.36 },
  "ahmedabad||in": { lat: 23.02, lng: 72.57 },
  "singapore||sg": { lat: 1.35, lng: 103.82 },
  "hong kong||hk": { lat: 22.32, lng: 114.17 },
  "tokyo||jp": { lat: 35.68, lng: 139.69 },
  "osaka||jp": { lat: 34.69, lng: 135.5 },
  "seoul||kr": { lat: 37.57, lng: 126.98 },
  "shanghai||cn": { lat: 31.23, lng: 121.47 },
  "beijing||cn": { lat: 39.9, lng: 116.41 },
  "shenzhen||cn": { lat: 22.54, lng: 114.06 },
  "manila||ph": { lat: 14.6, lng: 120.98 },
  "jakarta||id": { lat: -6.21, lng: 106.85 },
  "kuala lumpur||my": { lat: 3.14, lng: 101.69 },
  "ho chi minh city||vn": { lat: 10.82, lng: 106.63 },
  "hanoi||vn": { lat: 21.03, lng: 105.85 },
  "bangkok||th": { lat: 13.76, lng: 100.5 },
  "sydney||au": { lat: -33.87, lng: 151.21 },
  "melbourne||au": { lat: -37.81, lng: 144.96 },
  "brisbane||au": { lat: -27.47, lng: 153.03 },
  "perth||au": { lat: -31.95, lng: 115.86 },
  "auckland||nz": { lat: -36.85, lng: 174.76 },
  "wellington||nz": { lat: -41.29, lng: 174.78 },

  // ── Middle East, Africa, Latin America ──
  "dubai||ae": { lat: 25.2, lng: 55.27 },
  "abu dhabi||ae": { lat: 24.45, lng: 54.38 },
  "riyadh||sa": { lat: 24.71, lng: 46.68 },
  "tel aviv||il": { lat: 32.09, lng: 34.78 },
  "istanbul||tr": { lat: 41.01, lng: 28.98 },
  "cairo||eg": { lat: 30.04, lng: 31.24 },
  "johannesburg||za": { lat: -26.2, lng: 28.05 },
  "cape town||za": { lat: -33.92, lng: 18.42 },
  "lagos||ng": { lat: 6.52, lng: 3.38 },
  "nairobi||ke": { lat: -1.29, lng: 36.82 },
  "mexico city||mx": { lat: 19.43, lng: -99.13 },
  "guadalajara||mx": { lat: 20.66, lng: -103.35 },
  "sao paulo||br": { lat: -23.55, lng: -46.63 },
  "rio de janeiro||br": { lat: -22.91, lng: -43.17 },
  "buenos aires||ar": { lat: -34.6, lng: -58.38 },
  "santiago||cl": { lat: -33.45, lng: -70.67 },
  "bogota||co": { lat: 4.71, lng: -74.07 },
  "lima||pe": { lat: -12.05, lng: -77.04 },
  "san jose||cr": { lat: 9.93, lng: -84.08 },
  "panama city||pa": { lat: 8.98, lng: -79.52 },
};

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ");

/**
 * Look up a centroid. Tries city+region+country, then city+country, so
 * "Austin, TX, US" and "Austin, US" both resolve.
 */
export function centroid(
  city: string | null | undefined,
  region: string | null | undefined,
  country: string | null | undefined
): LatLng | null {
  const c = norm(city);
  if (!c) return null;
  const cc = norm(country);
  const rr = norm(region);
  return (
    CENTROIDS[`${c}|${rr}|${cc}`] ??
    CENTROIDS[`${c}||${cc}`] ??
    Object.entries(CENTROIDS).find(([k]) => {
      const [kc, , kcountry] = k.split("|");
      return kc === c && kcountry === cc;
    })?.[1] ??
    null
  );
}

/** Great-circle distance in miles, or null when either point is unknown. */
export function distanceMiles(a: LatLng | null, b: LatLng | null): number | null {
  if (!a || !b) return null;
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

export function hasCentroid(
  city: string | null | undefined,
  region: string | null | undefined,
  country: string | null | undefined
): boolean {
  return centroid(city, region, country) !== null;
}
