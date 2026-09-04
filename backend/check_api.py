"""Diagnose the Google API setup: `python check_api.py`.

Answers the only question worth asking when the app says something failed -
is it the key, the model name, or the quota? Never prints the key itself.
"""

import os
import sys
import time

from dotenv import load_dotenv

load_dotenv(".env")
KEY = os.getenv("GOOGLE_API_KEY", "")


def redact(text: str) -> str:
    return text.replace(KEY, "<KEY>") if KEY else text


def diagnose(exc: Exception) -> str:
    text = str(exc).upper()
    if "NOT_FOUND" in text or "IS NOT FOUND" in text:
        return "That model name has been retired. Pick one from the list above."
    if "API_KEY_INVALID" in text or "UNAUTHENTICATED" in text or "PERMISSION_DENIED" in text:
        return "Google rejected the key. Regenerate it at aistudio.google.com/apikey."
    if "RESOURCE_EXHAUSTED" in text or "429" in text or "QUOTA" in text:
        return ("Free-tier quota or rate limit hit. Wait a minute; if it persists "
                "you are out of requests for the day.")
    return "Unrecognised failure - the full message is above."


if not KEY:
    sys.exit("GOOGLE_API_KEY is missing. Copy .env.example to .env and paste your key.")
print(f"key loaded: {len(KEY)} characters\n")

from google import genai                                    # noqa: E402
from langchain_google_genai import (                        # noqa: E402
    ChatGoogleGenerativeAI,
    GoogleGenerativeAIEmbeddings,
)

import main                                                 # noqa: E402
import rag                                                  # noqa: E402

# Keep the client referenced: the pager it returns fails if it is collected.
client = genai.Client(api_key=KEY)
try:
    models = list(client.models.list())
except Exception as exc:
    print(redact(str(exc))[:400])
    sys.exit("\nCould not even list models. " + diagnose(exc))

def supporting(action):
    return [m.name for m in models if action in set(getattr(m, "supported_actions", None) or [])]

print("embedding models available to this key:")
for name in supporting("embedContent"):
    print("  ", name)
print("\nchat models available to this key (flash):")
for name in supporting("generateContent"):
    if "flash" in name and "image" not in name and "tts" not in name:
        print("  ", name)

print(f"\nconfigured: {rag.EMBEDDING_MODEL} + {main.CHAT_MODEL}\n")

failed = False
for label, model, call in [
    ("embedding", rag.EMBEDDING_MODEL,
     lambda: f"{len(GoogleGenerativeAIEmbeddings(model=rag.EMBEDDING_MODEL).embed_query('ping'))} dims"),
    ("chat", main.CHAT_MODEL,
     lambda: ChatGoogleGenerativeAI(model=main.CHAT_MODEL, temperature=0).invoke("say ok").text),
]:
    started = time.time()
    try:
        result = call()
        print(f"{label:<10} {model:<32} OK  ({time.time() - started:.1f}s)  {result}")
    except Exception as exc:
        failed = True
        print(f"{label:<10} {model:<32} FAILED")
        print("  ", redact(str(exc))[:400])
        print("  ->", diagnose(exc))

sys.exit(1 if failed else 0)
