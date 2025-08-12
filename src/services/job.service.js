import { replicate } from "../config/replicate.js";

// Poll Replicate predictions until done, return .output (array/obj/string)
export async function pollUntilDone(predictionUrlOrId, { intervalMs = 1500 } = {}) {
  // Accept either full URL or just an ID
  let id = predictionUrlOrId;
  if (typeof predictionUrlOrId === "string" && predictionUrlOrId.includes("/predictions/")) {
    id = predictionUrlOrId.split("/predictions/").pop();
  }

  while (true) {
    const updated = await replicate.predictions.get(id);
    if (updated.status === "succeeded") return updated.output;
    if (updated.status === "failed") throw new Error("Prediction failed");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}