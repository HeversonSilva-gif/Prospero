// Re-triggers a passed callback when costs-new broadcasts arrive. Used by
// /costs route to refresh the heavy `costs:query` only when something
// actually changed (vs polling).

import { useEffect } from "react";

export const useCostsStream = (callback: () => void): void => {
  useEffect(() => {
    const off = window.dashboardAgent.costs.onNew(() => {
      callback();
    });
    return off;
  }, [callback]);
};
