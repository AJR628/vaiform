import { createHash } from "node:crypto";

const CURATED = {
  calm: "https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg",
  ocean: "https://upload.wikimedia.org/wikipedia/commons/0/02/Ocean_waves.jpg",
  mountain: "https://upload.wikimedia.org/wikipedia/commons/7/73/Lake_mapourika_NZ.jpeg",
  forest: "https://upload.wikimedia.org/wikipedia/commons/a/a7/Forest_in_La_Hoja%2C_Panama.jpg",
  sky: "https://upload.wikimedia.org/wikipedia/commons/0/0b/Blue_sky_%28Unsplash%29.jpg",
  night: "https://upload.wikimedia.org/wikipedia/commons/0/09/Stars_in_the_night_sky.jpg",
  city: "https://upload.wikimedia.org/wikipedia/commons/1/1e/NYC_skyline_at_night.jpg",
};

const FALLBACKS = [
  "https://picsum.photos/1080/1920.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/7/73/Lake_mapourika_NZ.jpeg",
];

export async function resolveStockImage({ query }) {
  const key = (query || "").toLowerCase().trim();
  if (CURATED[key]) return CURATED[key];

  const hash = createHash("sha1").update(key).digest();
  const idx = hash[0] % FALLBACKS.length;
  return FALLBACKS[idx];
}

export default { resolveStockImage };


