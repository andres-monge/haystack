import { useCallback, useState } from "react";
import { getWeather, searchLocations } from "../api/client";
import type {
  CurrentConditions,
  HourlyConditions,
  Location,
} from "../types";

export function useLocationSearch() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      setLocations([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await searchLocations(query);
      setLocations(res.locations);
    } catch {
      setLocations([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const clear = useCallback(() => setLocations([]), []);

  return { locations, isSearching, search, clear };
}

export function useWeather() {
  const [current, setCurrent] = useState<CurrentConditions | null>(null);
  const [hourly, setHourly] = useState<HourlyConditions[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetch = useCallback(
    async (lat: number, lon: number, timezone: string) => {
      setIsLoading(true);
      try {
        const res = await getWeather({ lat, lon, timezone });
        setCurrent(res.current);
        setHourly(res.hourly);
        return res;
      } catch {
        setCurrent(null);
        setHourly([]);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const clear = useCallback(() => {
    setCurrent(null);
    setHourly([]);
  }, []);

  return { current, hourly, isLoading, fetch, clear };
}
