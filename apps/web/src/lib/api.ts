const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api";

export const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      "content-type": "application/json",
    },
    ...init,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : `Request failed: ${response.status}`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as T;
};

export const describeLoadError = (
  route: {
    name: "overview" | "runs" | "run" | "step" | "commit";
  },
  error: unknown,
  fallback: string,
): string => {
  if (error instanceof Error) {
    const status = "status" in error ? error.status : undefined;
    if (status === 404) {
      if (route.name === "run") {
        return "Run not found. Old local data may have been deleted.";
      }
      if (route.name === "step") {
        return "Step not found. Old local data may have been deleted.";
      }
      if (route.name === "commit") {
        return "Commit not found. Old local data may have been deleted.";
      }
      return error.message;
    }

    return error.message;
  }

  return fallback;
};
