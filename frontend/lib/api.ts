import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001",
});

/** Build a query string with account_id plus optional extra params. */
export function withAccount(
  accountId: number,
  extra?: Record<string, string | number | boolean | undefined | null>,
): string {
  const params = new URLSearchParams({ account_id: String(accountId) });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v != null && v !== "") params.set(k, String(v));
    }
  }
  return `?${params.toString()}`;
}

export default api;
