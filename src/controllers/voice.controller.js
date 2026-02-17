import { z } from 'zod';

const PreviewVoiceSchema = z.object({
  voiceId: z.string().min(1),
  text: z.string().min(1).max(100).default('Hello, this is a preview of my voice.'),
});

// ElevenLabs voice library - these are popular, high-quality voices
const ELEVENLABS_VOICES = [
  {
    id: 'JBFqnCBsd6RMkjVDRZzb', // Adam
    name: 'Adam',
    description: 'Warm, confident male voice',
    category: 'male',
    accent: 'american',
  },
  {
    id: 'EXAVITQu4vr4xnSDxMaL', // Bella
    name: 'Bella',
    description: 'Calm, professional female voice',
    category: 'female',
    accent: 'american',
  },
  {
    id: 'VR6AewLTigWG4xSOukaG', // Arnold
    name: 'Arnold',
    description: 'Deep, authoritative male voice',
    category: 'male',
    accent: 'american',
  },
  {
    id: 'AZnzlk1XvdvUeBnXmlld', // Domi
    name: 'Domi',
    description: 'Energetic, dynamic female voice',
    category: 'female',
    accent: 'american',
  },
  {
    id: 'ErXwobaYiN019PkySvjV', // Antoni
    name: 'Antoni',
    description: 'Smooth, charismatic male voice',
    category: 'male',
    accent: 'american',
  },
  {
    id: 'MF3mGyEYCl7XYWbV9V6O', // Elli
    name: 'Elli',
    description: 'Friendly, approachable female voice',
    category: 'female',
    accent: 'american',
  },
  {
    id: 'TxGEqnHWrfWFTfGW9XjX', // Josh
    name: 'Josh',
    description: 'Casual, relatable male voice',
    category: 'male',
    accent: 'american',
  },
  {
    id: 'XB0fDUnXU5Txlol1ua2t', // Sarah
    name: 'Sarah',
    description: 'Clear, articulate female voice',
    category: 'female',
    accent: 'american',
  },
  {
    id: 'VR6AewLTigWG4xSOukaG', // Arnold
    name: 'Arnold',
    description: 'Deep, authoritative male voice',
    category: 'male',
    accent: 'american',
  },
  {
    id: 'pNInz6obpgDQGcFmaJgB', // Adam
    name: 'Adam',
    description: 'Warm, confident male voice',
    category: 'male',
    accent: 'american',
  },
];

export async function getVoices(req, res) {
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(503).json({
        success: false,
        error: 'ELEVENLABS_NOT_CONFIGURED',
        message: 'ElevenLabs API key not configured',
      });
    }

    return res.json({
      success: true,
      data: {
        voices: ELEVENLABS_VOICES,
        provider: 'elevenlabs',
      },
    });
  } catch (error) {
    console.error('Error getting voices:', error);
    return res.status(500).json({
      success: false,
      error: 'VOICE_FETCH_FAILED',
      message: error.message,
    });
  }
}

export async function previewVoice(req, res) {
  try {
    const parsed = PreviewVoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        detail: parsed.error.flatten(),
      });
    }

    const { voiceId, text } = parsed.data;

    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(503).json({
        success: false,
        error: 'ELEVENLABS_NOT_CONFIGURED',
        message: 'ElevenLabs API key not configured',
      });
    }

    // Generate preview audio using ElevenLabs
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        model_id: 'eleven_flash_v2_5',
        text,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs API error:', response.status, errorText);
      return res.status(response.status).json({
        success: false,
        error: 'ELEVENLABS_API_ERROR',
        message: `ElevenLabs API error: ${response.status}`,
      });
    }

    const audioBuffer = await response.arrayBuffer();

    // Return the audio as base64 for frontend playback
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

    return res.json({
      success: true,
      data: {
        audio: `data:audio/mpeg;base64,${base64Audio}`,
        voiceId,
        text,
        duration: null, // Could be calculated if needed
      },
    });
  } catch (error) {
    console.error('Error generating voice preview:', error);
    return res.status(500).json({
      success: false,
      error: 'VOICE_PREVIEW_FAILED',
      message: error.message,
    });
  }
}
