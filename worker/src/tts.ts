import type { Env } from './env';
import { checkRateLimit } from './rate-limit';
import { getToken } from './auth';

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel — neutral English female
const ELEVENLABS_MODEL = 'eleven_turbo_v2_5';    // Cheap + fast; quality is fine for bubble text

interface TTSRequest {
  text: string;
  voice_id?: string;
}

export async function handleTTS(req: Request, env: Env): Promise<Response> {
  // TTS calls hit the same per-token rate limit as /chat.
  const token = getToken(req);
  const limited = await checkRateLimit(token, env);
  if (limited) return limited;

  if (!env.ELEVENLABS_API_KEY) {
    return jsonError('ELEVENLABS_API_KEY not configured on Worker', 503);
  }

  let body: TTSRequest;
  try {
    body = (await req.json()) as TTSRequest;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  if (!body.text || typeof body.text !== 'string') {
    return jsonError('text field required', 400);
  }
  // Cap input to keep cost predictable — ElevenLabs charges per character.
  // Bubble messages are short by design (1-2 sentences); summaries can be
  // longer but we hard-cap here as a safety net.
  const text = body.text.slice(0, 600);
  const voiceId = body.voice_id || DEFAULT_VOICE_ID;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': env.ELEVENLABS_API_KEY,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const errBody = await response.text();
    console.error(`[Assistant Worker] ElevenLabs ${response.status}: ${errBody}`);
    return new Response(errBody, {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'audio/mpeg',
      'cache-control': 'no-cache',
    },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
