import { useCallback, useEffect, useState } from 'react';
import { isSyntheticDemo } from './syntheticDemo';
import { getPatchDashboard, getStationData } from './api';

function usePolling(load) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const refresh = useCallback(async () => {
    try {
      const data = await load();
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState({ data: null, error: error.message, loading: false });
    }
  }, [load]);
  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const timer = setInterval(refresh, isSyntheticDemo ? 2000 : 10000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [refresh]);
  return { ...state, refresh };
}

export function useStationData(station) {
  const load = useCallback(() => getStationData(station), [station]);
  return usePolling(load);
}

export function usePatchData() {
  const load = useCallback(() => getPatchDashboard(), []);
  return usePolling(load);
}
