import { Cloud, CloudRain, CloudSun, Droplets, Loader2, Sun, WifiOff, Wind } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ManifestItem } from '@signage/shared/contracts';

interface WeatherSnapshot {
  cityLabel: string;
  tempC: number;
  humidity: number;
  windKmh: number;
  weatherCode: number;
  fetchedAt: number;
}

function describeWeatherCode(code: number): string {
  if (code === 0) return 'Clear Sky';
  if (code <= 3) return 'Partly Cloudy';
  if (code <= 48) return 'Haze / Fog';
  if (code <= 67) return 'Rain Showers';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Heavy Showers';
  return 'Thunderstorm';
}

function WeatherIcon({ code, className }: { code: number; className?: string }) {
  if (code === 0) return <Sun className={className} />;
  if (code <= 3) return <CloudSun className={className} />;
  if (code <= 67 || code >= 80) return <CloudRain className={className} />;
  return <Cloud className={className} />;
}

export interface WeatherWidgetProps {
  item: ManifestItem;
  isOnline: boolean;
  compact: boolean;
}

export function WeatherWidget({ item, isOnline, compact }: WeatherWidgetProps) {
  const cfg = item.appConfig ?? {};
  const city = typeof cfg.city === 'string' && cfg.city.trim() ? cfg.city.trim() : 'Mumbai';
  const unit = cfg.unit === 'F' ? 'F' : 'C';
  const fallbackMessage =
    typeof cfg.fallbackMessage === 'string' && cfg.fallbackMessage.trim()
      ? cfg.fallbackMessage.trim()
      : 'Live weather temporarily unavailable';
  const cacheKey = `signage_weather_cache_${city.toLowerCase()}`;

  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      return raw ? (JSON.parse(raw) as WeatherSnapshot) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;
    setLoading(true);

    const loadWeather = async () => {
      try {
        const geoRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
        );
        if (!geoRes.ok) throw new Error('Geocoding failed');
        const geo = (await geoRes.json()) as {
          results?: Array<{ name: string; country?: string; latitude: number; longitude: number }>;
        };
        const place = geo.results?.[0];
        if (!place) throw new Error('City not found');

        const wxRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`,
        );
        if (!wxRes.ok) throw new Error('Forecast failed');
        const wx = (await wxRes.json()) as {
          current?: {
            temperature_2m?: number;
            relative_humidity_2m?: number;
            weather_code?: number;
            wind_speed_10m?: number;
          };
        };
        if (!wx.current || cancelled) return;

        const next: WeatherSnapshot = {
          cityLabel: place.country ? `${place.name}, ${place.country}` : place.name,
          tempC: wx.current.temperature_2m ?? 26,
          humidity: wx.current.relative_humidity_2m ?? 60,
          windKmh: wx.current.wind_speed_10m ?? 10,
          weatherCode: wx.current.weather_code ?? 1,
          fetchedAt: Date.now(),
        };
        setSnapshot(next);
        localStorage.setItem(cacheKey, JSON.stringify(next));
      } catch {
        // Keep cached snapshot
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadWeather();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, city, isOnline]);

  if (!snapshot) {
    return (
      <div
        data-creative-type="weather"
        data-creative-fallback="1"
        className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-zinc-900 p-6 text-center text-white"
      >
        {loading && isOnline ? (
          <>
            <Loader2 className="mb-3 h-10 w-10 animate-spin text-sky-400" />
            <div className="text-base font-semibold">Loading weather for {city}...</div>
            <div className="mt-1 text-xs text-slate-400">{fallbackMessage}</div>
          </>
        ) : (
          <>
            <WifiOff className="mb-3 h-10 w-10 text-amber-400" />
            <div className="text-base font-semibold">{city} Weather</div>
            <div className="mt-1 text-xs text-slate-300">{fallbackMessage}</div>
          </>
        )}
      </div>
    );
  }

  const displayTemp =
    unit === 'F' ? Math.round((snapshot.tempC * 9) / 5 + 32) : Math.round(snapshot.tempC);

  return (
    <div
      data-creative-type="weather"
      className={`flex h-full w-full flex-col justify-between bg-gradient-to-br from-sky-950 via-slate-950 to-zinc-950 text-white ${
        compact ? 'p-4' : 'p-12'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold tracking-widest text-sky-300 uppercase">
            Live Weather • {item.title}
          </div>
          <h1 className={`mt-1 font-bold tracking-tight ${compact ? 'text-xl' : 'text-5xl'}`}>
            {snapshot.cityLabel}
          </h1>
          <div className={`mt-1 text-slate-300 ${compact ? 'text-xs' : 'text-xl'}`}>
            {describeWeatherCode(snapshot.weatherCode)}
          </div>
        </div>

        {!isOnline && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-200">
            <WifiOff className="h-3 w-3" />
            Cached Offline
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <WeatherIcon
            code={snapshot.weatherCode}
            className={compact ? 'h-14 w-14 text-amber-300' : 'h-28 w-28 text-amber-300'}
          />
          <div className={`font-extrabold tracking-tighter ${compact ? 'text-5xl' : 'text-8xl'}`}>
            {displayTemp}°{unit}
          </div>
        </div>

        <div className={`space-y-2 text-slate-200 ${compact ? 'text-xs' : 'text-lg'}`}>
          <div className="flex items-center gap-2">
            <Droplets className="h-4 w-4 text-sky-300" />
            <span>Humidity: {Math.round(snapshot.humidity)}%</span>
          </div>
          <div className="flex items-center gap-2">
            <Wind className="h-4 w-4 text-sky-300" />
            <span>Wind: {Math.round(snapshot.windKmh)} km/h</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-white/10 pt-3 text-xs text-slate-400">
        <span>Powered by Open-Meteo</span>
        <span>Updated {new Date(snapshot.fetchedAt).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
