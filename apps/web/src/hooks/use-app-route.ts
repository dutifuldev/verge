import { useEffect, useState } from "react";

import { parseRoute, type AppRoute } from "../lib/routing.js";

export const useAppRoute = (): AppRoute => {
  const [route, setRoute] = useState<AppRoute>(parseRoute());

  useEffect(() => {
    const syncRoute = (): void => setRoute(parseRoute());
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  return route;
};
