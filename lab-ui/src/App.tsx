import { useCallback, useState } from "react";
import { ImageUpload } from "./components/ImageUpload";
import { LocationPicker } from "./components/LocationPicker";
import { TimeControls } from "./components/TimeControls";
import { WeatherDisplay } from "./components/WeatherDisplay";
import { PromptEditor } from "./components/PromptEditor";
import { GenerateButton } from "./components/GenerateButton";
import { PreviewPanel } from "./components/PreviewPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { useGenerate } from "./hooks/useGenerate";
import { useHistory } from "./hooks/useHistory";
import { useLocationSearch, useWeather } from "./hooks/useWeather";
import { getTimeOfDayDescription, WMO_DESCRIPTIONS } from "./utils/scenario";
import type { RenderMetadata, SelectedLocation } from "./types";
import SunCalc from "suncalc";

// Duplicated from src/engine/prompt.ts — keep in sync with server-side template.
const DEFAULT_TEMPLATE = `Using the provided artwork, reimagine this scene as if viewed through a window at the current moment in time.

Time: {scenario}

The setting, architecture, and environment are permanent — but the scene is alive. People and animals go about their day naturally for this time and weather. Consider who would be here now, what they would be doing, how the light falls at this hour, and how people would be dressed for the current conditions.

Reading the weather data:
- Sun elevation: negative = below horizon, 0° = at horizon (sunrise/sunset), 90° = directly overhead. Low positive angles produce long shadows and warm golden light.
- Direct radiation (W/m²): 0 = no direct sunlight (night or dense clouds), high values = crisp hard shadows.
- Diffuse radiation (W/m²): high relative to direct = soft, even, shadowless overcast light.
- Moon illuminated %: 0% = new moon (very dark night), 100% = full moon (bright silvery nightscape). Only relevant at night.
- Visibility (meters): below 1000 = dense fog, 1000-5000 = haze/mist, above 10000 = clear air.

Rules:
- Preserve the EXACT artistic style, medium, and rendering technique of the original
- Keep the architecture, signage, furniture, and environment layout identical
- Characters may change position, appear, or leave — but must match the original art style exactly
- Lighting must be physically consistent with the time of day and weather
- Weather should affect the scene naturally (wet surfaces, fog, snow, etc.)
- Do NOT change the camera angle, framing, scale, or composition
- Do NOT add modern or anachronistic elements
- Do NOT add text, watermarks, or UI elements`;

export function App() {
  // State
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [location, setLocation] = useState<SelectedLocation | null>(null);
  const [hour, setHour] = useState(() => new Date().getHours());
  const [isDay, setIsDay] = useState(() => {
    const h = new Date().getHours();
    return h >= 6 && h <= 20;
  });
  const [promptOverride, setPromptOverride] = useState(DEFAULT_TEMPLATE);

  // For displaying a selected history item
  const [selectedResult, setSelectedResult] = useState<{
    metadata: RenderMetadata;
    imageUrl: string;
  } | null>(null);

  // Hooks
  const generate = useGenerate();
  const history = useHistory();
  const locationSearch = useLocationSearch();
  const weather = useWeather();

  // Use weather isDay when available, otherwise fall back to local state
  const effectiveIsDay = weather.current ? weather.current.isDay : isDay;

  // Derived state — mirrors describeScenario on the server
  const scenarioPreview = (() => {
    const parts = [getTimeOfDayDescription(hour, effectiveIsDay)];
    const c = weather.current;
    if (c) {
      const wmoDesc = WMO_DESCRIPTIONS[c.weatherCode];
      if (wmoDesc) parts.push(wmoDesc.toLowerCase());
      parts.push(`${c.temperature}°C`);
      parts.push(`humidity ${c.humidity}%`);
      parts.push(`wind ${c.windSpeed} km/h`);
      parts.push(`visibility ${c.visibility}m`);
      if (c.precipitation > 0) parts.push(`precipitation ${c.precipitation}mm/h`);
      if (c.snowfall > 0) parts.push(`snowfall ${c.snowfall}cm/h`);
      if (c.snowDepth > 0) parts.push(`snow depth ${c.snowDepth}m`);
      parts.push(`direct radiation ${c.directRadiation} W/m²`);
      parts.push(`diffuse radiation ${c.diffuseRadiation} W/m²`);
    }
    // Compute sun/moon from location + hour (mirrors server-side suncalc)
    if (location) {
      const dateStr = new Date().toLocaleDateString("en-CA", { timeZone: location.timezone });
      const dateForHour = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:00:00`);
      const sunPos = SunCalc.getPosition(dateForHour, location.lat, location.lon);
      const sunEl = Math.round(sunPos.altitude * (180 / Math.PI) * 10) / 10;
      const sunAz = Math.round(((sunPos.azimuth * (180 / Math.PI)) + 180) * 10) / 10;
      parts.push(`sun elevation ${sunEl}°`);
      parts.push(`sun azimuth ${sunAz}°`);
      if (!effectiveIsDay) {
        const moonIllum = SunCalc.getMoonIllumination(dateForHour);
        parts.push(`moon ${Math.round(moonIllum.fraction * 100)}% illuminated`);
        const moonPos = SunCalc.getMoonPosition(dateForHour, location.lat, location.lon);
        const moonAlt = Math.round(moonPos.altitude * (180 / Math.PI) * 10) / 10;
        if (moonAlt > 0) parts.push(`moon altitude ${moonAlt}°`);
      }
    }
    return parts.join(", ");
  })();

  // Handlers
  const handleLocationSelected = useCallback(
    async (loc: SelectedLocation) => {
      setLocation(loc);
      // Update hour to current time in the selected timezone
      const localHour = new Intl.DateTimeFormat("en-US", {
        timeZone: loc.timezone,
        hour: "numeric",
        hour12: false,
      }).formatToParts(new Date()).find((p) => p.type === "hour");
      const tzHour = parseInt(localHour?.value ?? "0", 10);
      setHour(tzHour === 24 ? 0 : tzHour);

      const res = await weather.fetchWeather(loc.lat, loc.lon, loc.timezone);
      if (res?.current) {
        setIsDay(res.current.isDay);
      }
    },
    [weather.fetchWeather],
  );

  const handleGenerate = useCallback(async () => {
    if (!selectedImage) return;

    const params: Parameters<typeof generate.run>[0] = {
      image: selectedImage,
      hour,
      isDay,
    };

    // Include location for weather fetch on server
    if (location) {
      params.lat = location.lat;
      params.lon = location.lon;
      params.timezone = location.timezone;
    }

    // Include prompt override if it differs from default
    if (promptOverride.trim() && promptOverride !== DEFAULT_TEMPLATE) {
      params.promptOverride = promptOverride;
    }

    const result = await generate.run(params);
    if (result) {
      setSelectedResult(result);
      void history.refresh();
    }
  }, [selectedImage, hour, isDay, location, promptOverride, generate.run, history.refresh]);

  const handleHistorySelect = useCallback(
    (render: RenderMetadata & { imageUrl: string }) => {
      setSelectedResult({ metadata: render, imageUrl: render.imageUrl });
    },
    [],
  );

  // Active result: selected history item takes priority (for comparison),
  // falls back to latest generation
  const activeResult = selectedResult ?? generate.result;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Haystack Lab</h1>
      </header>
      <main className="app-main">
        <div className="controls-column">
          <ImageUpload
            onImageSelected={setSelectedImage}
            selectedImage={selectedImage}
          />
          <LocationPicker
            onLocationSelected={handleLocationSelected}
            selectedLocation={location}
            locations={locationSearch.locations}
            isSearching={locationSearch.isSearching}
            onSearch={locationSearch.search}
            onClearResults={locationSearch.clear}
          />
          <TimeControls
            hour={hour}
            isDay={effectiveIsDay}
            onHourChange={setHour}
            onIsDayChange={setIsDay}
          />
          <WeatherDisplay
            current={weather.current}
            isLoading={weather.isLoading}
          />
          <PromptEditor
            value={promptOverride}
            defaultTemplate={DEFAULT_TEMPLATE}
            scenarioPreview={scenarioPreview}
            onChange={setPromptOverride}
          />
          <GenerateButton
            disabled={!selectedImage}
            isGenerating={generate.isGenerating}
            onClick={handleGenerate}
          />
        </div>
        <div className="results-column">
          <PreviewPanel
            metadata={activeResult?.metadata ?? null}
            imageUrl={activeResult?.imageUrl ?? null}
            error={generate.error}
          />
          <HistoryPanel
            renders={history.renders}
            isLoading={history.isLoading}
            onSelect={handleHistorySelect}
          />
        </div>
      </main>
    </div>
  );
}
