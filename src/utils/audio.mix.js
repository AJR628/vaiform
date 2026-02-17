export function buildAudioMixArgs({
  haveBgAudio,
  bgAudioStream = '0:a',
  ttsPath,
  keepVideoAudio = false,
  bgAudioVolume = 1.0,
  duckDuringTTS = false,
  duck = { threshold: -18, ratio: 8, attack: 40, release: 250 },
  applyFade = false,
  durationSec,
}) {
  const extraInputs = [];
  const parts = [];
  let mapAudio = [];
  let codecAudio = [];

  const volLabel = 'bgv';
  const duckLabel = 'ducked';

  const haveTts = Boolean(ttsPath);
  const fadeDur =
    applyFade && typeof durationSec === 'number'
      ? Math.max(0.3, Math.min(0.7, durationSec * 0.07))
      : null;

  if (!haveTts) {
    if (keepVideoAudio && haveBgAudio) {
      if (fadeDur) {
        parts.push(
          `[${bgAudioStream}]volume=${Number(bgAudioVolume).toFixed(3)},afade=in:st=0:d=${fadeDur.toFixed(2)},afade=out:st=${Math.max(0, durationSec - fadeDur).toFixed(2)}:d=${fadeDur.toFixed(2)}[aout]`
        );
      } else {
        parts.push(`[${bgAudioStream}]volume=${Number(bgAudioVolume).toFixed(3)}[aout]`);
      }
      mapAudio = ['-map', '[aout]'];
      codecAudio = ['-c:a', 'aac'];
    } else {
      // silent; caller should add -an
      mapAudio = [];
      codecAudio = [];
    }
    return { extraInputs, filterComplex: parts.join(';'), mapAudio, codecAudio };
  }

  // With TTS
  extraInputs.push('-i', ttsPath);
  if (keepVideoAudio && haveBgAudio) {
    parts.push(`[${bgAudioStream}]volume=${Number(bgAudioVolume).toFixed(3)}[${volLabel}]`);
    if (duckDuringTTS) {
      parts.push(
        `[${volLabel}][1:a]sidechaincompress=threshold=${duck.threshold ?? -18}:ratio=${duck.ratio ?? 8}:attack=${duck.attack ?? 40}:release=${duck.release ?? 250}[${duckLabel}]`
      );
      if (fadeDur) {
        parts.push(
          `[${duckLabel}][1:a]amix=inputs=2:normalize=0,afade=in:st=0:d=${fadeDur.toFixed(2)},afade=out:st=${Math.max(0, durationSec - fadeDur).toFixed(2)}:d=${fadeDur.toFixed(2)}[aout]`
        );
      } else {
        parts.push(`[${duckLabel}][1:a]amix=inputs=2:normalize=0[aout]`);
      }
    } else {
      if (fadeDur) {
        parts.push(
          `[${volLabel}][1:a]amix=inputs=2:normalize=0,afade=in:st=0:d=${fadeDur.toFixed(2)},afade=out:st=${Math.max(0, durationSec - fadeDur).toFixed(2)}:d=${fadeDur.toFixed(2)}[aout]`
        );
      } else {
        parts.push(`[${volLabel}][1:a]amix=inputs=2:normalize=0[aout]`);
      }
    }
  } else {
    parts.push(`[1:a]anull[aout]`);
  }
  mapAudio = ['-map', '[aout]'];
  codecAudio = ['-c:a', 'aac'];
  return { extraInputs, filterComplex: parts.join(';'), mapAudio, codecAudio };
}

export default { buildAudioMixArgs };
