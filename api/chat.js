export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const apiKey = (body.apiKey && body.apiKey.trim()) || process.env.API_KEY || '';
    const baseUrl = (body.baseUrl || process.env.BASE_URL || 'https://api.aicredits.in/v1').replace(/\/+$/, '');
    const model = body.model || process.env.MODEL_NAME || 'mistralai/mistral-nemo';
    const messages = body.messages || [];

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key is required. Please set API_KEY in your Vercel environment variables or enter it in Settings.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        stream: true,
      }),
    });

    if (!upstreamResponse.ok) {
      const err = await upstreamResponse.text();
      return new Response(JSON.stringify({ error: err }), {
        status: upstreamResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(upstreamResponse.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
