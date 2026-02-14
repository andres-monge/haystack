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
import { getTimeOfDayDescription, getWeatherDescription } from "./utils/scenario";
import type { RenderMetadata, SelectedLocation } from "./types";

// Duplicated from src/engine/prompt.ts — keep in sync with server-side template.
const DEFAULT_TEMPLATE = `Transform this artwork to reflect the current moment:

Time: {scenario}

Guidelines:
- Adjust lighting naturally (sun position, shadows, ambient light)
- If the scene has artificial light sources (lamps, candles), light them appropriately for the time
- Maintain the original composition and subjects
- Preserve the artistic style of the original
- Make changes subtle and atmospheric, not dramatic
- If night: add moonlight, starlight, or warm indoor lighting
- If day: adjust sun position and shadow direction
- Do not add new objects, people, or text
- Preserve the original scale, framing, and composition exactly`;

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

  // Derived state
  const scenarioPreview =
    getTimeOfDayDescription(hour) +
    getWeatherDescription(weather.current?.weatherCode);

  // Handlers
  const handleLocationSelected = useCallback(
    async (loc: SelectedLocation) => {
      setLocation(loc);
      await weather.fetchWeather(loc.lat, loc.lon, loc.timezone);
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

  // Active result: latest generation or selected history item
  const activeResult = generate.result ?? selectedResult;

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
            isDay={isDay}
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
