param(
  [string]$AppUrl = "https://wandreel.com",
  [string]$ApiBaseUrl = "https://api.wandreel.com",
  [string]$CorsAllowedOrigins = "https://wandreel.com"
)

$env:APP_URL = $AppUrl
$env:API_BASE_URL = $ApiBaseUrl
$env:CORS_ALLOWED_ORIGINS = $CorsAllowedOrigins

if (-not $env:COOKIE_DOMAIN) { $env:COOKIE_DOMAIN = ".wandreel.com" }
if (-not $env:OPENAI_MODEL) { $env:OPENAI_MODEL = "gpt-5-nano" }
if (-not $env:OPENAI_API_KEY) { $env:OPENAI_API_KEY = "preflight-placeholder" }

node deployment/scripts/preflight.mjs
