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
import type { RenderMetadata } from "./types";

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

function getTimeOfDayDescription(hour: number): string {
  if (hour >= 5 && hour < 7) return "early morning, dawn breaking";
  if (hour >= 7 && hour < 12) return "morning, bright daylight";
  if (hour >= 12 && hour < 14) return "midday, sun high overhead";
  if (hour >= 14 && hour < 17) return "afternoon, warm light";
  if (hour >= 17 && hour < 20) return "evening, golden hour, sunset";
  if (hour >= 20 && hour < 22) return "dusk, twilight";
  return "night, darkness, moonlight";
}

function getWeatherDescription(weatherCode?: number): string {
  if (weatherCode === undefined) return "";
  const map: Record<number, string> = {
    0: ", clear sky",
    1: ", mainly clear",
    2: ", partly cloudy",
    3: ", overcast",
    45: ", foggy",
    48: ", foggy with frost",
    51: ", light drizzle",
    61: ", light rain",
    63: ", moderate rain",
    65: ", heavy rain",
    71: ", light snow",
    73: ", moderate snow",
    95: ", thunderstorm",
  };
  return map[weatherCode] ?? "";
}

export function App() {
  // State
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [location, setLocation] = useState<{
    lat: number;
    lon: number;
    timezone: string;
    name: string;
  } | null>(null);
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
    async (loc: { lat: number; lon: number; timezone: string; name: string }) => {
      setLocation(loc);
      await weather.fetch(loc.lat, loc.lon, loc.timezone);
    },
    [weather],
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
      history.refresh();
    }
  }, [selectedImage, hour, isDay, location, promptOverride, generate, history]);

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
