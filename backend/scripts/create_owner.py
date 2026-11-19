"""Bootstrap the first Owner user — no route creates one, since every
user-creation endpoint requires an authenticated Owner/TL caller.

Usage: python -m scripts.create_owner "Mukul" mukul@kontent.media <password>
"""
import asyncio
import sys

from app.core.security import hash_password
from app.db.session import async_session_factory
from app.models.user import User


async def main(name: str, email: str, password: str) -> None:
    async with async_session_factory() as db:
        user = User(name=name, email=email, password_hash=hash_password(password), role="owner")
        db.add(user)
        await db.commit()
        print(f"Created owner {email}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python -m scripts.create_owner <name> <email> <password>")
        raise SystemExit(1)
    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3]))
