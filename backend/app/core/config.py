from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://kontent:kontent@db:5432/kontent"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    uploads_dir: str = "/data/uploads"
    cors_origins: list[str] = ["http://localhost:5173"]

    # Which day a QC2 charge is spent against (docs/12-qc2-load-model.md §3).
    # The only clock in the app that is not UTC, and deliberately: a points
    # budget is a promise about a *working day*, and in UTC it would roll over
    # at 05:30 IST — before anyone starts, so it would mostly have worked,
    # which is the worst kind of accident to leave in a schedule.
    qc2_day_timezone: str = "Asia/Kolkata"

    # --- Web Push (desktop notifications) ---
    # VAPID is how a push service knows the server is who it claims to be: one
    # keypair for the whole application, the public half handed to the browser
    # when it subscribes, the private half signing every send.
    #
    # Empty is the normal state until the keys are generated, and the app has
    # to boot and pass its tests without them — same pattern as
    # `openrouter_api_key` above. `services/push.py` treats an empty key as
    # "push is off" and the endpoints answer 503 with a message that says so,
    # rather than failing somewhere deeper in the encryption.
    #
    # Both halves are url-safe base64 of the raw bytes — the public key is the
    # 65-byte uncompressed P-256 point the browser passes as
    # `applicationServerKey`, the private key is the 32-byte scalar. That is
    # the format `py_vapid.Vapid.from_string` expects; see `.env.example` for
    # the command that generates a pair.
    #
    # One keypair per *deployment*, and generate it once: a browser's
    # subscription is tied to the public key it was created against, so
    # replacing the pair silently unsubscribes everybody who already turned
    # desktop alerts on. Local development uses its own pair — localhost and
    # production are different origins with different subscriptions anyway,
    # and there is nothing to be learned from a dev box holding the
    # production secret.
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    # Who the push service should complain to. Must be a mailto: or https:
    # URL — the spec requires a contact, and the services do reject sends
    # without one.
    vapid_subject: str = "mailto:ops@kontent.media"

    # --- Kontent Bot (Phase 3, docs/11-ai-chatbot.md) ---
    # Empty key is the normal state until an OpenRouter account exists: the
    # tool layer and its tests need none, and /api/chat answers 503 with a
    # usable message rather than failing somewhere deeper.
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    # Any OpenRouter slug. The gateway is the point — swapping models is this
    # one line, never a code change (docs/08-roadmap.md).
    openrouter_model: str = "google/gemini-2.5-flash"
    # OpenRouter attributes usage to these; they show up on the dashboard.
    openrouter_app_url: str = "https://kontent.media"
    openrouter_app_title: str = "Kontent OS"
    # How many times the agent may go round the call-a-tool loop before it has
    # to answer with what it has. Each round is a paid request upstream.
    # Raised from 6 when charting landed: a charted answer spends its first
    # rounds resolving and looking up as before, then one more per chart it
    # draws. At 6 those answers were hitting the cap and losing the graph.
    ai_max_tool_iterations: int = 8
    ai_request_timeout_seconds: int = 60
    # Per-user, rolling 24h. This is the first endpoint in the app where a
    # loop costs real money — see docs/00-status.md on the missing rate limits.
    ai_daily_message_cap: int = 50


    # --- WhatsApp Cloud API (direct Meta, no BSP) — docs/13-whatsapp.md ---
    # Empty token is the normal state of a fresh checkout and of the test
    # database, exactly like `openrouter_api_key` and the VAPID pair above:
    # `services/whatsapp/client.py::whatsapp_enabled()` reads it as "the
    # integration is off", every send is skipped with a reason on the record,
    # and the admin routes answer 503 with a sentence rather than failing
    # somewhere deeper in an HTTP call.
    #
    # The token must be a **System User** token, not a personal one. A user
    # token expires after 60 days and the notifications then stop on a
    # Tuesday afternoon with nothing in the log that looks like a cause.
    whatsapp_access_token: str = ""
    # The number messages are sent *from*. Not the WABA id — they are
    # different objects and the API takes them in different places: sends go
    # to /{phone_number_id}/messages, templates to /{waba_id}/message_templates.
    whatsapp_phone_number_id: str = ""
    whatsapp_business_account_id: str = ""
    # Meta signs every webhook with HMAC-SHA256 of the raw body under the
    # app secret. That signature is the *only* thing standing between the
    # public internet and an endpoint that can move jobs through the
    # pipeline, so an empty secret means inbound is refused outright rather
    # than trusted — see `routers/whatsapp_webhook.py`.
    whatsapp_app_secret: str = ""
    # Our own random string, echoed back during Meta's one-time webhook
    # handshake. Not a secret in the cryptographic sense; it only proves the
    # subscription was set up by someone who could read this file.
    whatsapp_verify_token: str = ""
    # Pinned, never floating. Meta ships breaking changes behind version
    # numbers and "whatever is current" is how an integration breaks on a
    # date nobody chose. Bump it deliberately, with the changelog open.
    whatsapp_graph_version: str = "v21.0"
    whatsapp_default_language: str = "en"
    whatsapp_request_timeout_seconds: int = 20
    # Used to turn "9876543210" into "919876543210". Staff numbers are typed
    # by a human into an admin form and almost never arrive in E.164; see
    # `services/whatsapp/phone.py` for what is and is not guessed.
    whatsapp_default_country_code: str = "91"
    # How often the background reconcile re-reads template status from Meta
    # and sends the deadline/stuck-round alerts. The webhook is what makes
    # status *fast*; this is what makes it *true* after a missed delivery.
    whatsapp_reconcile_interval_seconds: int = 60 * 60

    # --- Forgot-password email ---
    # Plain SMTP, so any provider works (Gmail app password, SES, Zoho, ...).
    # Empty host is the normal state of a fresh checkout and of the test
    # database: forgot-password then answers exactly as it does when it works
    # (so it never reveals whether an address exists) and logs a warning that
    # no mail went out.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    # STARTTLS on the given port. Set false only for a local mail catcher.
    smtp_use_tls: bool = True
    smtp_from: str = "Kontent OS <no-reply@kontent.media>"
    # Where the reset link points: the public origin of the frontend.
    frontend_base_url: str = "http://localhost:5173"
    password_reset_expire_minutes: int = 30


@lru_cache
def get_settings() -> Settings:
    return Settings()
