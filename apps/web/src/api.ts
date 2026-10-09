export type Role = "administrator" | "manager" | "coach";
export type Grant = { role: Role; scope: "club" | "assigned_sessions" };
export type Membership = {
  membership_id: string;
  authority_source?: "club" | "network_owner" | "platform";
  tenant_id: string;
  club_name: string;
  grants: Grant[];
};
export type Network = { network_id: string; name: string; version: number };
export type Session = {
  account_id: string;
  expires_at: string;
  memberships: Membership[];
  networks?: Network[];
  platform_administrator?: boolean;
};
export class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export async function request<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    const csrfResponse = await fetch("/api/v1/access/csrf", {
      cache: "no-store",
    });
    if (!csrfResponse.ok)
      throw new APIError(csrfResponse.status, "BOOTSTRAP_FAILED");
    headers["X-CSRF-Token"] = (await csrfResponse.json()).csrf_token;
    if (data !== undefined) headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: "no-store",
  });
  const body = res.status === 204 ? undefined : await res.json();
  if (!res.ok) {
    if (res.status === 401 && body?.code !== "LOGIN_FAILED")
      window.dispatchEvent(new Event("judeos-session-ended"));
    throw new APIError(res.status, body?.code || "REQUEST_FAILED");
  }
  return body as T;
}
export function errorMessage(e: unknown) {
  if (e instanceof APIError)
    return e.status === 409
      ? "Запись изменилась. Обновите данные перед новой попыткой."
      : e.status === 403
        ? "Ваших прав недостаточно для этого действия."
        : e.status === 401
          ? "Войдите снова."
          : e.status === 429
            ? "Попробуйте позже."
            : e.code === "LINK_INVALID"
              ? "Проверьте получателя и срок ссылки."
              : "Запрос отклонён. Проверьте поля.";
  return "Не удалось связаться с сервером. Обновите список, чтобы проверить результат.";
}
