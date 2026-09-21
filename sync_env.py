# Synchronize .env to env.js so the frontend can read it directly
import os

env_path = os.path.join(os.path.dirname(__file__), '.env')
env_js_path = os.path.join(os.path.dirname(__file__), 'env.js')

config = {}
if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, val = line.split('=', 1)
                config[key.strip()] = val.strip()

api_key = config.get('API_KEY', '')
base_url = config.get('BASE_URL', 'https://api.aicredits.in/v1')
model_name = config.get('MODEL_NAME', 'mistralai/mistral-nemo')
supabase_url = config.get('SUPABASE_URL', '')
supabase_anon_key = config.get('SUPABASE_ANON_KEY', '')

js_content = f"""// Auto-generated configuration from .env
window.ENV = {{
  API_KEY: {repr(api_key)},
  BASE_URL: {repr(base_url)},
  MODEL_NAME: {repr(model_name)},
  SUPABASE_URL: {repr(supabase_url)},
  SUPABASE_ANON_KEY: {repr(supabase_anon_key)}
}};
"""

with open(env_js_path, 'w', encoding='utf-8') as f:
    f.write(js_content)

print("Synchronized .env to env.js successfully.")
