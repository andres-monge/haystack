import { useCallback, useState } from "react";
import { getWeather, searchLocations } from "../api/client";
import type {
  CurrentConditions,
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
  const [isLoading, setIsLoading] = useState(false);

  const fetchWeather = useCallback(
    async (lat: number, lon: number, timezone: string) => {
      setIsLoading(true);
      try {
        const res = await getWeather({ lat, lon, timezone });
        setCurrent(res.current);
        return res;
      } catch {
        setCurrent(null);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  return { current, isLoading, fetchWeather };
}
