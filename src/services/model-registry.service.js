import ideogram from "../adapters/ideogram.adapter.js";        // realistic (txt2img)
import sdxl from "../adapters/sdxl.adapter.js";                // cartoon (txt2img)
import pixar from "../adapters/hidream-pixar.adapter.js";      // pixar (img2img)

const registry = {
  realistic: ideogram,
  cartoon: sdxl,
  pixar: pixar,
};

export function getAdapter(style = "realistic") {
  return registry[style] || ideogram;
}