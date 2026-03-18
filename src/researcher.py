"""
LLM-powered vendor research for uncategorized transactions.
Sends ONLY bank description text — never amounts, dates, or personal info.
Uses Grok (xAI) for both research and enrichment.
"""
import json
import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────────────

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


# ── JSON extraction ─────────────────────────────────────────────────────────

_JSON_RE = re.compile(r'\{[^{}]*\}', re.DOTALL)
_JSON_ARRAY_RE = re.compile(r'\[.*\]', re.DOTALL)


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


def _parse_llm_response_array(text: str) -> list[dict] | None:
    """Extract a JSON array from LLM response text."""
    # Strip markdown fences
    cleaned = re.sub(r'```(?:json)?\s*', '', text).strip()
    cleaned = re.sub(r'```\s*$', '', cleaned).strip()
    try:
        result = json.loads(cleaned)
        if isinstance(result, list):
            return result
    except (json.JSONDecodeError, ValueError):
        pass
    # Try extracting array from surrounding text
    match = _JSON_ARRAY_RE.search(text)
    if match:
        try:
            result = json.loads(match.group())
            if isinstance(result, list):
                return result
        except (json.JSONDecodeError, ValueError):
            pass
    return None


# ── Grok (xAI) API — single description ─────────────────────────────────────

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


# ── Constrained-choice batch research ────────────────────────────────────────

BATCH_SIZE = 50  # descriptions per LLM call

_CONSTRAINED_SYSTEM_PROMPT = """You are a financial transaction classifier. You will classify bank transaction descriptions using the user's EXISTING vendors, categories, and projects.

RULES:
1. ALWAYS use an existing category from the provided list. Never invent new categories.
2. PREFER existing vendors. Only create a new vendor if no existing vendor is a plausible match.
3. Set is_new_vendor to true ONLY when creating a genuinely new vendor not in the existing list.
4. For new vendors: use clean title case (e.g. "Whole Foods Market"), and pick the closest existing category.
5. If you cannot determine the vendor at all, set vendor_name to null.
6. For project: use the correspondence history to infer which project a vendor or category typically belongs to. Only use existing projects from the provided list. Set to null if no confident match.

Respond ONLY with a JSON array. No explanation, no markdown."""


def _build_constrained_prompt(
    descriptions: list[str],
    vendors: list[dict],
    categories: list[str],
    projects: list[str],
    correspondence: list[dict],
) -> str:
    """Build the user prompt with context for constrained classification.

    correspondence: list of {desc, vendor, category, project, source} dicts
        where source is 'approved', 'user-edited', or 'rule-matched'.
    """
    parts = []

    # Vendor list with patterns and default categories
    if vendors:
        vendor_lines = []
        for v in vendors[:250]:  # cap to avoid token overflow
            line = f"- {v['name']} [{v.get('category', '?')}]"
            if v.get("patterns"):
                line += f" (patterns: {', '.join(v['patterns'][:5])})"
            vendor_lines.append(line)
        parts.append("Existing Vendors:\n" + "\n".join(vendor_lines))

    # Categories
    if categories:
        parts.append("Existing Categories: " + ", ".join(categories))

    # Projects
    if projects:
        parts.append("Existing Projects: " + ", ".join(projects))

    # Correspondence history — verified past mappings ranked by quality
    if correspondence:
        hist_lines = []
        for c in correspondence[:40]:
            line = f'- "{c["desc"]}" -> vendor: {c["vendor"]}, category: {c["category"]}'
            if c.get("project"):
                line += f', project: {c["project"]}'
            line += f' [{c["source"]}]'
            hist_lines.append(line)
        parts.append("Correspondence History (verified past mappings):\n" + "\n".join(hist_lines))

    # Descriptions to classify
    desc_lines = []
    for i, desc in enumerate(descriptions):
        desc_lines.append(f"{i}: {scrub_description(desc)}")
    parts.append("Classify these descriptions:\n" + "\n".join(desc_lines))

    parts.append(
        'Respond with a JSON array where each element has: '
        '{"index": <int>, "vendor_name": <str|null>, "category": <str>, "trade_category": <str>, "project": <str|null>, "is_new_vendor": <bool>}'
    )

    return "\n\n".join(parts)


async def _query_grok_batch(user_prompt: str) -> list[dict] | None:
    """Send a batch constrained prompt to Grok and return parsed array."""
    api_key = os.getenv("XAI_API_KEY")
    if not api_key:
        raise ValueError("XAI_API_KEY not set. Add it to your .env file.")
    messages = [
        {"role": "system", "content": _CONSTRAINED_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(
                "https://api.x.ai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "content-type": "application/json",
                },
                json={
                    "model": "grok-4-1-fast-reasoning",
                    "messages": messages,
                    "max_tokens": 16384,
                    "temperature": 0,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            return _parse_llm_response_array(content)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            raise ValueError("Invalid XAI_API_KEY. Check your .env file.")
        logger.warning("Grok batch query failed: %s", e)
        return None
    except Exception as e:
        logger.warning("Grok batch query failed: %s", e)
        return None


async def research_descriptions_constrained(
    descriptions: list[str],
    vendors: list[dict],
    categories: list[str],
    projects: list[str],
    correspondence: list[dict],
) -> dict[str, dict]:
    """
    Constrained-choice batch research using Grok.
    Sends context (existing vendors, categories, projects, correspondence history)
    so the LLM picks from the user's taxonomy instead of inventing names.

    Returns {description: {vendor_name, trade_category, category, project, is_new_vendor}}.
    """
    results: dict[str, dict] = {}

    # Filter skippable — no cap, process all descriptions
    to_process = [d for d in descriptions if not is_skippable(d)]
    if not to_process:
        return results

    # Process in batches (context sent with each batch)
    for i in range(0, len(to_process), BATCH_SIZE):
        batch = to_process[i:i + BATCH_SIZE]
        user_prompt = _build_constrained_prompt(batch, vendors, categories, projects, correspondence)

        parsed = await _query_grok_batch(user_prompt)
        if not parsed:
            logger.warning("Batch %d failed, skipping %d descriptions", i // BATCH_SIZE, len(batch))
            continue

        for item in parsed:
            idx = item.get("index")
            if idx is None or idx < 0 or idx >= len(batch):
                continue
            vendor_name = item.get("vendor_name")
            if vendor_name:
                results[batch[idx]] = {
                    "vendor_name": vendor_name,
                    "trade_category": item.get("trade_category"),
                    "category": item.get("category"),
                    "project": item.get("project"),
                    "is_new_vendor": item.get("is_new_vendor", True),
                }

    return results


# ── Shared batch query with custom system prompt ────────────────────────────

async def _query_grok_batch_with_system(user_prompt: str, system_prompt: str) -> list[dict] | None:
    """Send a batch prompt to Grok with a custom system prompt and return parsed array."""
    api_key = os.getenv("XAI_API_KEY")
    if not api_key:
        raise ValueError("XAI_API_KEY not set. Add it to your .env file.")
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                "https://api.x.ai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "content-type": "application/json",
                },
                json={
                    "model": "grok-4-1-fast-non-reasoning",
                    "messages": messages,
                    "max_tokens": 2048,
                    "temperature": 0,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            return _parse_llm_response_array(content)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            raise ValueError("Invalid XAI_API_KEY. Check your .env file.")
        logger.warning("Grok batch query failed: %s", e)
        return None
    except Exception as e:
        logger.warning("Grok batch query failed: %s", e)
        return None


# ── Category-only research ───────────────────────────────────────────────────

_CATEGORY_SYSTEM_PROMPT = """You are a financial transaction classifier. You will assign expense categories to transactions using ONLY the user's existing categories.

RULES:
1. ALWAYS use an existing category from the provided list. Never invent new categories.
2. Use the vendor name, description, and correspondence history to determine the best category.
3. If you cannot confidently determine a category, set category to null.

Respond ONLY with a JSON array. No explanation, no markdown."""


def _build_category_prompt(
    transactions: list[dict],
    categories: list[str],
    correspondence: list[dict],
) -> str:
    """Build prompt for category-only classification."""
    parts = []

    if categories:
        parts.append("Existing Categories: " + ", ".join(categories))

    if correspondence:
        hist_lines = []
        for c in correspondence[:40]:
            line = f'- "{c["desc"]}" (vendor: {c.get("vendor", "?")}) -> category: {c["category"]}'
            line += f' [{c["source"]}]'
            hist_lines.append(line)
        parts.append("Correspondence History (verified past mappings):\n" + "\n".join(hist_lines))

    desc_lines = []
    for i, tx in enumerate(transactions):
        line = f'{i}: {scrub_description(tx["description"])}'
        if tx.get("vendor"):
            line += f' (vendor: {tx["vendor"]})'
        desc_lines.append(line)
    parts.append("Assign categories to these transactions:\n" + "\n".join(desc_lines))

    parts.append(
        'Respond with a JSON array where each element has: '
        '{"index": <int>, "category": <str|null>}'
    )

    return "\n\n".join(parts)


async def research_categories(
    transactions: list[dict],
    categories: list[str],
    correspondence: list[dict],
) -> dict[int, dict]:
    """
    Category-only research. Transactions already have vendors assigned.
    Returns {index: {"category": str}} for successful lookups.
    """
    results: dict[int, dict] = {}
    to_process = transactions
    if not to_process:
        return results

    for i in range(0, len(to_process), BATCH_SIZE):
        batch = to_process[i:i + BATCH_SIZE]
        user_prompt = _build_category_prompt(batch, categories, correspondence)

        parsed = await _query_grok_batch_with_system(user_prompt, _CATEGORY_SYSTEM_PROMPT)
        if not parsed:
            logger.warning("Category batch %d failed, skipping %d", i // BATCH_SIZE, len(batch))
            continue

        for item in parsed:
            idx = item.get("index")
            if idx is None or idx < 0 or idx >= len(batch):
                continue
            category = item.get("category")
            if category:
                results[i + idx] = {"category": category}

    return results


# ── Project-only research ────────────────────────────────────────────────────

_PROJECT_SYSTEM_PROMPT = """You are a financial transaction classifier. You will assign projects to transactions using ONLY the user's existing projects.

RULES:
1. ALWAYS use an existing project from the provided list. Never invent new projects.
2. Use the vendor name, category, description, and correspondence history to determine which project this transaction belongs to.
3. If you cannot confidently determine a project, set project to null.

Respond ONLY with a JSON array. No explanation, no markdown."""


def _build_project_prompt(
    transactions: list[dict],
    projects: list[str],
    correspondence: list[dict],
) -> str:
    """Build prompt for project-only classification."""
    parts = []

    if projects:
        parts.append("Existing Projects: " + ", ".join(projects))

    if correspondence:
        hist_lines = []
        for c in correspondence[:40]:
            if not c.get("project"):
                continue
            line = f'- "{c["desc"]}" (vendor: {c.get("vendor", "?")}, category: {c.get("category", "?")}) -> project: {c["project"]}'
            line += f' [{c["source"]}]'
            hist_lines.append(line)
        parts.append("Correspondence History (verified past mappings):\n" + "\n".join(hist_lines))

    desc_lines = []
    for i, tx in enumerate(transactions):
        line = f'{i}: {scrub_description(tx["description"])}'
        if tx.get("vendor"):
            line += f' (vendor: {tx["vendor"]})'
        if tx.get("category"):
            line += f' (category: {tx["category"]})'
        desc_lines.append(line)
    parts.append("Assign projects to these transactions:\n" + "\n".join(desc_lines))

    parts.append(
        'Respond with a JSON array where each element has: '
        '{"index": <int>, "project": <str|null>}'
    )

    return "\n\n".join(parts)


async def research_projects(
    transactions: list[dict],
    projects: list[str],
    correspondence: list[dict],
) -> dict[int, dict]:
    """
    Project-only research. Transactions already have vendors/categories.
    Returns {index: {"project": str}} for successful lookups.
    """
    results: dict[int, dict] = {}
    to_process = transactions
    if not to_process:
        return results

    for i in range(0, len(to_process), BATCH_SIZE):
        batch = to_process[i:i + BATCH_SIZE]
        user_prompt = _build_project_prompt(batch, projects, correspondence)

        parsed = await _query_grok_batch_with_system(user_prompt, _PROJECT_SYSTEM_PROMPT)
        if not parsed:
            logger.warning("Project batch %d failed, skipping %d", i // BATCH_SIZE, len(batch))
            continue

        for item in parsed:
            idx = item.get("index")
            if idx is None or idx < 0 or idx >= len(batch):
                continue
            project = item.get("project")
            if project:
                results[i + idx] = {"project": project}

    return results
