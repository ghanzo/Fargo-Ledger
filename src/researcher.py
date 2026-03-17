"""
LLM-powered vendor research for uncategorized transactions.
Sends ONLY bank description text — never amounts, dates, or personal info.
Supports Ollama (local, default) and Claude API (optional).
"""
import json
import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────────────

OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama")
ENRICH_PROVIDER = os.getenv("ENRICH_PROVIDER", "grok")

# ── Privacy filters ─────────────────────────────────────────────────────────

_PERSONAL_PATTERNS = [
    "PAYPAL", "VENMO", "ZELLE", "CASHAPP", "CASH APP",
    "POPMONEY", "P2P", "PERSON TO PERSON",
    "APPLE CASH", "GOOGLE PAY",
]

_TRANSFER_PATTERNS = [
    "TRANSFER FROM", "TRANSFER TO", "ONLINE TRANSFER",
    "HOME BANKING TRANSFER", "WIRE TRANSFER",
    "ACH CREDIT", "ACH DEBIT",
    "MOBILE DEPOSIT",
]


def is_skippable(description: str) -> bool:
    """Return True if description is a personal transfer or too vague for research."""
    upper = description.upper()
    for p in _PERSONAL_PATTERNS:
        if p in upper:
            return True
    for p in _TRANSFER_PATTERNS:
        if p in upper:
            return True
    # Skip very short descriptions (likely generic)
    if len(description.strip()) < 5:
        return True
    return False


# Patterns that may contain personal info in bank descriptions
_SCRUB_PATTERNS = [
    re.compile(r'\bNAME:\s*\S+(?:\s+\S+)*', re.IGNORECASE),       # NAME: JOHN DOE
    re.compile(r'\bID:\s*\S+', re.IGNORECASE),                     # ID: 1234567890
    re.compile(r'\bONLINE ID:\s*\S+', re.IGNORECASE),              # ONLINE ID: 5940742640
    re.compile(r'\bCO:\s*\S+', re.IGNORECASE),                     # CO: COMPANYNAME
    re.compile(r'\bREF\s*#?\s*\d+', re.IGNORECASE),                # REF # 19124401
    re.compile(r'\b[Xx]+\d{2,4}\b'),                               # XXXXXXXXXX or XX1234 (masked account numbers)
    re.compile(r'Share\s+\d+', re.IGNORECASE),                     # Share 10 (account share numbers)
    re.compile(r'\bfrom\s+\*[\d\w-]+\s+to\s+\*[\d\w-]+', re.IGNORECASE),  # from *94-S10 to *84-S10
]


def scrub_description(description: str) -> str:
    """Remove personal identifiers from a bank description before sending to LLM."""
    result = description
    for pattern in _SCRUB_PATTERNS:
        result = pattern.sub("", result)
    # Collapse multiple spaces
    result = re.sub(r'\s{2,}', ' ', result).strip()
    return result


# ── Prompt ──────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """You are a financial transaction classifier. Given a bank transaction description, identify:
1. vendor_name: The business name (clean, title case, e.g. "Whole Foods Market")
2. trade_category: The type of business (e.g. "Grocery Store", "Gas Station", "Restaurant", "Utility")
3. category: The expense category (e.g. "Groceries", "Transportation", "Dining Out", "Utilities")

If you cannot determine the vendor, set vendor_name to null.
Respond ONLY with a JSON object. No explanation, no markdown."""

_USER_TEMPLATE = "Description: {description}"


def _build_messages(description: str) -> list[dict]:
    scrubbed = scrub_description(description)
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": _USER_TEMPLATE.format(description=scrubbed)},
    ]


# ── JSON extraction ─────────────────────────────────────────────────────────

_JSON_RE = re.compile(r'\{[^{}]*\}', re.DOTALL)


def _parse_llm_response(text: str) -> dict | None:
    """Extract a JSON object from LLM response text, handling markdown fences."""
    # Try direct parse first
    try:
        return json.loads(text.strip())
    except (json.JSONDecodeError, ValueError):
        pass
    # Try extracting JSON from markdown or surrounding text
    match = _JSON_RE.search(text)
    if match:
        try:
            return json.loads(match.group())
        except (json.JSONDecodeError, ValueError):
            pass
    return None


# ── Ollama ──────────────────────────────────────────────────────────────────

async def query_ollama(description: str, base_url: str = OLLAMA_URL, model: str = OLLAMA_MODEL) -> dict | None:
    """Send a description to Ollama and return parsed vendor info."""
    messages = _build_messages(description)
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{base_url}/api/chat",
                json={"model": model, "messages": messages, "stream": False},
            )
            resp.raise_for_status()
            data = resp.json()
            content = data.get("message", {}).get("content", "")
            return _parse_llm_response(content)
    except httpx.ConnectError:
        logger.error("Cannot connect to Ollama at %s", base_url)
        raise ConnectionError(f"Cannot connect to Ollama at {base_url}. Is Ollama running?")
    except Exception as e:
        logger.warning("Ollama query failed for description: %s", e)
        return None


# ── Claude API ──────────────────────────────────────────────────────────────

async def query_claude(description: str) -> dict | None:
    """Send a description to Claude API and return parsed vendor info."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")
    messages = [{"role": "user", "content": _USER_TEMPLATE.format(description=description)}]
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 256,
                    "system": _SYSTEM_PROMPT,
                    "messages": messages,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            content = data.get("content", [{}])[0].get("text", "")
            return _parse_llm_response(content)
    except Exception as e:
        logger.warning("Claude query failed: %s", e)
        return None


# ── Grok (xAI) API ──────────────────────────────────────────────────────────

async def query_grok(description: str) -> dict | None:
    """Send a description to xAI Grok API and return parsed vendor info."""
    api_key = os.getenv("XAI_API_KEY")
    if not api_key:
        raise ValueError("XAI_API_KEY not set. Add it to your .env file.")
    messages = _build_messages(description)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.x.ai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "content-type": "application/json",
                },
                json={
                    "model": "grok-4-1-fast-non-reasoning",
                    "messages": messages,
                    "max_tokens": 256,
                    "temperature": 0,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            return _parse_llm_response(content)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            raise ValueError("Invalid XAI_API_KEY. Check your .env file.")
        logger.warning("Grok query failed: %s", e)
        return None
    except Exception as e:
        logger.warning("Grok query failed: %s", e)
        return None


# ── Vendor enrichment ──────────────────────────────────────────────────────

_ENRICH_SYSTEM_PROMPT = """You are a business information lookup assistant. Given a business/vendor name and sample bank transaction descriptions from that vendor, identify the real business and provide publicly available information.
Use the transaction descriptions to help identify the specific business — they often contain location, account type, or service clues.
Only include information you are confident about. If you are unsure about a field, set it to null.
Respond ONLY with a JSON object containing these fields:
- business_name: The full official business name (e.g. "Whole Foods Market, Inc.")
- trade_category: The type of business (e.g. "Grocery Store", "Plumber", "Electric Utility")
- website: The business website URL (e.g. "https://www.wholefoods.com")
- address: The main business address or headquarters
- phone: The main business phone number
- service_description: A brief description of what the business does/provides

No explanation, no markdown — just the JSON object."""


def _build_enrich_messages(vendor_name: str, sample_descriptions: list[str] | None = None, context: dict | None = None) -> list[dict]:
    user_content = f"Business/Vendor name: {vendor_name}"
    if context:
        if context.get("trade_category"):
            user_content += f"\nKnown business type: {context['trade_category']}"
        if context.get("categories_used"):
            user_content += f"\nExpense categories used: {', '.join(context['categories_used'])}"
        if context.get("transaction_count"):
            user_content += f"\nNumber of transactions: {context['transaction_count']}"
    if sample_descriptions:
        sample_descriptions = [scrub_description(d) for d in sample_descriptions]
        samples = "\n".join(f"  - {d}" for d in sample_descriptions[:5])
        user_content += f"\n\nSample bank transaction descriptions from this vendor:\n{samples}"
    return [
        {"role": "system", "content": _ENRICH_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


async def _enrich_ollama(vendor_name: str, sample_descriptions: list[str] | None = None, context: dict | None = None, base_url: str = OLLAMA_URL, model: str = OLLAMA_MODEL) -> dict | None:
    messages = _build_enrich_messages(vendor_name, sample_descriptions, context)
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{base_url}/api/chat",
                json={"model": model, "messages": messages, "stream": False},
            )
            resp.raise_for_status()
            data = resp.json()
            content = data.get("message", {}).get("content", "")
            return _parse_llm_response(content)
    except httpx.ConnectError:
        logger.error("Cannot connect to Ollama at %s", base_url)
        raise ConnectionError(f"Cannot connect to Ollama at {base_url}. Is Ollama running?")
    except Exception as e:
        logger.warning("Ollama enrich failed for vendor: %s", e)
        return None


async def _enrich_claude(vendor_name: str, sample_descriptions: list[str] | None = None, context: dict | None = None) -> dict | None:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")
    user_msg = _build_enrich_messages(vendor_name, sample_descriptions, context)[1]["content"]
    messages = [{"role": "user", "content": user_msg}]
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 512,
                    "system": _ENRICH_SYSTEM_PROMPT,
                    "messages": messages,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            content = data.get("content", [{}])[0].get("text", "")
            return _parse_llm_response(content)
    except Exception as e:
        logger.warning("Claude enrich failed: %s", e)
        return None


async def _enrich_grok(vendor_name: str, sample_descriptions: list[str] | None = None, context: dict | None = None) -> dict | None:
    api_key = os.getenv("XAI_API_KEY")
    if not api_key:
        raise ValueError("XAI_API_KEY not set. Add it to your .env file.")
    messages = _build_enrich_messages(vendor_name, sample_descriptions, context)
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                "https://api.x.ai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "content-type": "application/json",
                },
                json={
                    "model": "grok-4-1-fast-reasoning",
                    "messages": messages,
                    "max_tokens": 512,
                    "temperature": 0,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            return _parse_llm_response(content)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            raise ValueError("Invalid XAI_API_KEY. Check your .env file.")
        logger.warning("Grok enrich failed: %s", e)
        return None
    except Exception as e:
        logger.warning("Grok enrich failed: %s", e)
        return None


async def enrich_vendor(
    vendor_name: str,
    sample_descriptions: list[str] | None = None,
    context: dict | None = None,
    provider: str = ENRICH_PROVIDER,
) -> dict | None:
    """
    Ask the LLM to fill in publicly available business information for a vendor.
    Includes sample transaction descriptions and metadata context when available.
    Returns dict with keys: business_name, trade_category, website, address, phone, service_description.
    """
    if provider == "grok":
        return await _enrich_grok(vendor_name, sample_descriptions, context)
    elif provider == "claude":
        return await _enrich_claude(vendor_name, sample_descriptions, context)
    else:
        return await _enrich_ollama(vendor_name, sample_descriptions, context)


# ── Main research function ──────────────────────────────────────────────────

MAX_GROUPS_PER_RUN = 50


async def research_descriptions(
    descriptions: list[str],
    provider: str = LLM_PROVIDER,
) -> dict[str, dict]:
    """
    Research a list of representative descriptions.
    Returns {description: {vendor_name, trade_category, category}} for successful lookups.
    Processes sequentially to avoid overwhelming local Ollama.
    """
    results: dict[str, dict] = {}

    # Cap per run to keep response time reasonable
    to_process = descriptions[:MAX_GROUPS_PER_RUN]

    for desc in to_process:
        if is_skippable(desc):
            continue

        if provider == "grok":
            result = await query_grok(desc)
        elif provider == "claude":
            result = await query_claude(desc)
        else:
            result = await query_ollama(desc)

        if result and result.get("vendor_name"):
            results[desc] = {
                "vendor_name": result.get("vendor_name"),
                "trade_category": result.get("trade_category"),
                "category": result.get("category"),
            }

    return results
