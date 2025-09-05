export function buildAudioMixArgs({
  haveBgAudio,
  bgAudioStream = "0:a",
  ttsPath,
  keepVideoAudio = false,
  bgAudioVolume = 1.0,
  duckDuringTTS = false,
  duck = { threshold: -18, ratio: 8, attack: 40, release: 250 },
}) {
  const extraInputs = [];
  const parts = [];
  let mapAudio = [];
  let codecAudio = [];

  const volLabel = "bgv";
  const duckLabel = "ducked";

  const haveTts = Boolean(ttsPath);
  if (!haveTts) {
    if (keepVideoAudio && haveBgAudio) {
      parts.push(`[${bgAudioStream}]volume=${Number(bgAudioVolume).toFixed(3)}[outa]`);
      mapAudio = ["-map", "[outa]"];
      codecAudio = ["-c:a", "aac"];
    } else {
      // silent; caller should add -an
      mapAudio = [];
      codecAudio = [];
    }
    return { extraInputs, filterComplex: parts.join(";"), mapAudio, codecAudio };
  }

  // With TTS
  extraInputs.push("-i", ttsPath);
  if (keepVideoAudio && haveBgAudio) {
    parts.push(`[${bgAudioStream}]volume=${Number(bgAudioVolume).toFixed(3)}[${volLabel}]`);
    if (duckDuringTTS) {
      parts.push(`[${volLabel}][1:a]sidechaincompress=threshold=${duck.threshold ?? -18}:ratio=${duck.ratio ?? 8}:attack=${duck.attack ?? 40}:release=${duck.release ?? 250}[${duckLabel}]`);
      parts.push(`[${duckLabel}][1:a]amix=inputs=2:normalize=0[outa]`);
    } else {
      parts.push(`[${volLabel}][1:a]amix=inputs=2:normalize=0[outa]`);
    }
  } else {
    parts.push(`[1:a]anull[outa]`);
  }
  mapAudio = ["-map", "[outa]"];
  codecAudio = ["-c:a", "aac"];
  return { extraInputs, filterComplex: parts.join(";"), mapAudio, codecAudio };
}

export default { buildAudioMixArgs };


