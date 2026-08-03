const axios = require('axios');
const { googleApiKey, googleModel } = require('./config');

const PLACEHOLDER_VALUES = new Set(['', 'your_google_api_key_here']);

function isKeyConfigured() {
  return !PLACEHOLDER_VALUES.has((googleApiKey || '').trim());
}

/**
 * Calls Gemini's generateContent REST endpoint directly over HTTPS (no SDK,
 * no Python) and asks it to return strict JSON. Throws on any failure so
 * callers can decide how to fall back.
 *
 * Retries once on HTTP 429 (rate limit) after the delay Gemini itself
 * suggests (capped at 10s) - free-tier keys have low requests-per-minute
 * limits, so a short single retry meaningfully reduces spurious fallbacks
 * to the local mock analyzer without risking the caller's own timeout.
 */
async function generateJson(systemPrompt, userPrompt, { temperature = 0.1 } = {}) {
  if (!isKeyConfigured()) {
    throw new Error('GOOGLE_API_KEY is not configured');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:generateContent`;
  const requestBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
    },
  };

  let data;
  try {
    ({ data } = await axios.post(url, requestBody, {
      params: { key: googleApiKey },
      timeout: 45000,
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch (err) {
    if (err.response?.status === 429) {
      const retryMessage = err.response?.data?.error?.message || '';
      const match = retryMessage.match(/retry in ([\d.]+)s/i);
      const waitMs = Math.min(match ? Math.ceil(parseFloat(match[1]) * 1000) : 5000, 10000);
      console.warn(`[ai-service-node] Gemini rate-limited (429), retrying once in ${waitMs}ms`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      try {
        ({ data } = await axios.post(url, requestBody, {
          params: { key: googleApiKey },
          timeout: 45000,
          headers: { 'Content-Type': 'application/json' },
        }));
      } catch (retryErr) {
        const apiMessage = retryErr.response?.data?.error?.message;
        throw new Error(apiMessage ? `Gemini API error (${retryErr.response.status}): ${apiMessage}` : retryErr.message);
      }
    } else {
      const apiMessage = err.response?.data?.error?.message;
      throw new Error(apiMessage ? `Gemini API error (${err.response.status}): ${apiMessage}` : err.message);
    }
  }

  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  if (!text) {
    throw new Error('Empty response from Gemini');
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Gemini did not return valid JSON: ${err.message}`);
  }
}

module.exports = { generateJson, isKeyConfigured };
