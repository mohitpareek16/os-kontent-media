"""Outbound email over plain SMTP.

Only the password-reset flow sends mail today. `smtplib` is synchronous, so
the send runs in a worker thread rather than blocking the event loop — same
approach as `services/push.py`. With no `SMTP_HOST` configured nothing is
sent and the caller is told, so the app boots and passes its tests without a
mail account.
"""

import asyncio
import logging
import smtplib
from email.message import EmailMessage

from app.core.config import get_settings

logger = logging.getLogger("app.mailer")


def mail_enabled() -> bool:
    return bool(get_settings().smtp_host)


def _send_sync(to: str, subject: str, text: str, html: str | None) -> None:
    settings = get_settings()
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
        if settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_username:
            server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(msg)


async def send_email(to: str, subject: str, text: str, html: str | None = None) -> bool:
    """True if handed to the SMTP server. Never raises: a mail outage must not
    turn into a 500 that tells a stranger whether an address has an account."""
    if not mail_enabled():
        logger.warning("SMTP is not configured; email to %s was not sent", to)
        return False
    try:
        await asyncio.to_thread(_send_sync, to, subject, text, html)
        return True
    except Exception:
        logger.exception("Failed to send email to %s", to)
        return False
