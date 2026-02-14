import { useCallback, useEffect, useRef, useState } from "react";
import type { Location } from "../types";

interface Props {
  onLocationSelected: (location: {
    lat: number;
    lon: number;
    timezone: string;
    name: string;
  }) => void;
  selectedLocation: {
    lat: number;
    lon: number;
    timezone: string;
    name: string;
  } | null;
  locations: Location[];
  isSearching: boolean;
  onSearch: (query: string) => void;
  onClearResults: () => void;
}

export function LocationPicker({
  onLocationSelected,
  selectedLocation,
  locations,
  isSearching,
  onSearch,
  onClearResults,
}: Props) {
  const [query, setQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleInput = useCallback(
    (value: string) => {
      setQuery(value);
      setShowDropdown(true);
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSearch(value);
      }, 300);
    },
    [onSearch],
  );

  const handleSelect = useCallback(
    (location: Location) => {
      onLocationSelected({
        lat: location.lat,
        lon: location.lon,
        timezone: location.timezone,
        name: `${location.name}${location.admin1 ? `, ${location.admin1}` : ""}, ${location.country}`,
      });
      setQuery(
        `${location.name}${location.admin1 ? `, ${location.admin1}` : ""}, ${location.country}`,
      );
      setShowDropdown(false);
      onClearResults();
    },
    [onLocationSelected, onClearResults],
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="location-picker" ref={containerRef}>
      <label className="section-label">Location</label>
      <input
        type="text"
        className="location-input"
        placeholder="Search city..."
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => {
          if (locations.length > 0) setShowDropdown(true);
        }}
      />
      {selectedLocation && (
        <span className="location-selected">{selectedLocation.name}</span>
      )}
      {showDropdown && (query.trim().length > 0) && (
        <div className="location-dropdown">
          {isSearching && <div className="dropdown-item loading">Searching...</div>}
          {!isSearching && locations.length === 0 && query.trim().length > 0 && (
            <div className="dropdown-item empty">No results found</div>
          )}
          {locations.map((loc, i) => (
            <div
              key={`${loc.lat}-${loc.lon}-${i}`}
              className="dropdown-item"
              onClick={() => handleSelect(loc)}
            >
              <span className="location-name">{loc.name}</span>
              {loc.admin1 && (
                <span className="location-admin">, {loc.admin1}</span>
              )}
              <span className="location-country">, {loc.country}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
