"""Kontent Bot — the AI layer over ops data (Phase 3, docs/11-ai-chatbot.md).

Three parts, deliberately unaware of each other:

- `tools/`      — typed query functions. Know about jobs and pods, nothing
                  about HTTP or models.
- `openrouter`  — transport. Knows about HTTP, nothing about jobs.
- `agent`       — the loop that puts one in front of the other.

Swapping the model is a config change; swapping the gateway touches only
`openrouter.py`; adding a question the bot can answer touches only `tools/`.
"""
