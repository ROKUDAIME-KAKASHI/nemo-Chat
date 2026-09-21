export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  return new Response(
    JSON.stringify({
      configured: Boolean(process.env.API_KEY),
      baseUrl: process.env.BASE_URL || 'https://api.aicredits.in/v1',
      modelName: process.env.MODEL_NAME || 'mistralai/mistral-nemo',
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store',
      },
    }
  );
}
