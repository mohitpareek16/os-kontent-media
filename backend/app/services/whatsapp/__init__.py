"""WhatsApp Cloud API, talking to Meta directly — docs/13-whatsapp.md.

The package is split by *what it talks to*, not by feature:

    client.py     the Graph API, and the only place the token is handled
    phone.py      what somebody typed -> a number Meta will dial
    errors.py     Meta's numeric error codes -> English
    registry.py   every template's shape, and the code that fills it
    templates.py  submit / sync / diff against Meta's copy
    events.py     which job event becomes which template, and to whom
    send.py       the guard rails, the send, the delivery row
    inbound.py    webhook -> status updates, button taps, the 24-hour window
    scheduler.py  the loop behind reconcile, deadline and digest messages

Three rules hold the whole thing together, and breaking any of them is how
this stops being a notification channel and starts being an incident:

1. **WhatsApp is additive and never authoritative.** The in-app notification
   and the desktop push fire first and independently. Staff mute chats, Meta
   throttles numbers for reasons unrelated to this code, and template review
   takes as long as it takes. Nothing a deadline depends on may have WhatsApp
   as its only path.

2. **A WhatsApp failure never breaks a job move.** Sending happens in the
   background task that runs after the response, in its own session, exactly
   as `services/push.py` does and for the same reason: `notify()` runs inside
   the caller's transaction, and a message announcing work that a later
   failure rolled back is worse than silence.

3. **Meta decides what may be sent; we keep a copy of the decision.** The
   sender reads `whatsapp_templates`, never the API. Asking Meta on every
   hand-off would put a network round-trip in front of every stage change and
   would fail open the day they are slow.
"""
