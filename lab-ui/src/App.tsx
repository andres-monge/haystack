import { useCallback, useEffect, useState } from "react";
import { ImageUpload } from "./components/ImageUpload";
import { LocationPicker } from "./components/LocationPicker";
import { TimeControls } from "./components/TimeControls";
import { WeatherDisplay } from "./components/WeatherDisplay";
import { PromptEditor } from "./components/PromptEditor";
import { GenerateButton } from "./components/GenerateButton";
import { KioskOverride } from "./components/KioskOverride";
import { SchedulerPause } from "./components/SchedulerPause";
import { PreviewPanel } from "./components/PreviewPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { useGenerate } from "./hooks/useGenerate";
import { useHistory } from "./hooks/useHistory";
import { useLocationSearch, useWeather } from "./hooks/useWeather";
import { getDefaultTemplate, getScenarioPreview } from "./api/client";
import type { OverrideResult, RenderMetadata, SelectedLocation } from "./types";

export function App() {
  // State
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [location, setLocation] = useState<SelectedLocation | null>(null);
  const [hour, setHour] = useState(() => new Date().getHours());
  const [isDay, setIsDay] = useState(() => {
    const h = new Date().getHours();
    return h >= 6 && h <= 20;
  });
  const [defaultTemplate, setDefaultTemplate] = useState<string | null>(null);
  const [promptOverride, setPromptOverride] = useState("");
  const [scenarioPreview, setScenarioPreview] = useState("");

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

  // Fetch default template from server on mount
  useEffect(() => {
    getDefaultTemplate().then((template) => {
      setDefaultTemplate(template);
      setPromptOverride(template);
    }).catch((err) => {
      console.warn("Failed to fetch default template:", err);
      setDefaultTemplate("");
    });
  }, []);

  // Fetch scenario preview from server when inputs change
  useEffect(() => {
    const params: Parameters<typeof getScenarioPreview>[0] = {
      hour,
      isDay: effectiveIsDay,
    };
    if (location) {
      params.lat = location.lat;
      params.lon = location.lon;
      params.timezone = location.timezone;
    }
    if (weather.current) {
      params.weather = weather.current as unknown as Record<string, unknown>;
    }
    getScenarioPreview(params).then(setScenarioPreview).catch(() => {
      setScenarioPreview("");
    });
  }, [hour, effectiveIsDay, location, weather.current]);

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
    if (promptOverride.trim() && promptOverride !== defaultTemplate) {
      params.promptOverride = promptOverride;
    }

    const result = await generate.run(params);
    if (result) {
      setSelectedResult(result);
      void history.refresh();
    }
  }, [selectedImage, hour, isDay, location, promptOverride, defaultTemplate, generate.run, history.refresh]);

  const handleOverrideResult = useCallback(
    (result: OverrideResult) => {
      setSelectedResult(result);
      void history.refresh();
    },
    [history.refresh],
  );

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
            defaultTemplate={defaultTemplate ?? ""}
            scenarioPreview={scenarioPreview}
            onChange={setPromptOverride}
          />
          <GenerateButton
            disabled={!selectedImage}
            isGenerating={generate.isGenerating}
            onClick={handleGenerate}
          />
          <SchedulerPause />
          <KioskOverride onResult={handleOverrideResult} />
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
