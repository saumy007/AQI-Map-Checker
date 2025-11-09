import React, { useState, useEffect, useRef } from 'react';
import '@/App.css';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import axios from 'axios';
import { Search, Loader2, Layers, MapPin, Wind } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// AQI color interpolation function (0-1000 scale)
const getAQIColor = (aqi) => {
  // Clamp AQI to [0, 1000]
  const clampedAQI = Math.max(0, Math.min(1000, aqi));
  
  // Color stops with hex values
  const stops = [
    { value: 0, color: [0, 176, 80] },      // #00b050 green
    { value: 100, color: [0, 176, 80] },    // #00b050 green
    { value: 250, color: [255, 255, 102] }, // #ffff66 yellow
    { value: 500, color: [255, 153, 0] },   // #ff9900 orange
    { value: 750, color: [255, 51, 0] },    // #ff3300 red-orange
    { value: 1000, color: [153, 0, 0] }     // #990000 deep red
  ];
  
  // Find the two stops to interpolate between
  let lowerStop = stops[0];
  let upperStop = stops[stops.length - 1];
  
  for (let i = 0; i < stops.length - 1; i++) {
    if (clampedAQI >= stops[i].value && clampedAQI <= stops[i + 1].value) {
      lowerStop = stops[i];
      upperStop = stops[i + 1];
      break;
    }
  }
  
  // Linear interpolation
  const range = upperStop.value - lowerStop.value;
  const ratio = range === 0 ? 0 : (clampedAQI - lowerStop.value) / range;
  
  const r = Math.round(lowerStop.color[0] + ratio * (upperStop.color[0] - lowerStop.color[0]));
  const g = Math.round(lowerStop.color[1] + ratio * (upperStop.color[1] - lowerStop.color[1]));
  const b = Math.round(lowerStop.color[2] + ratio * (upperStop.color[2] - lowerStop.color[2]));
  
  return `rgb(${r}, ${g}, ${b})`;
};

// Get AQI category and description
const getAQICategory = (aqi) => {
  if (aqi <= 50) return { label: 'Good', description: 'Air quality is satisfactory' };
  if (aqi <= 100) return { label: 'Moderate', description: 'Acceptable air quality' };
  if (aqi <= 200) return { label: 'Unhealthy for Sensitive Groups', description: 'Sensitive people should reduce outdoor activity' };
  if (aqi <= 300) return { label: 'Unhealthy', description: 'Everyone may begin to experience health effects' };
  if (aqi <= 400) return { label: 'Very Unhealthy', description: 'Health alert: everyone may experience serious effects' };
  if (aqi <= 500) return { label: 'Hazardous', description: 'Health warnings of emergency conditions' };
  return { label: 'Beyond Index', description: 'Extremely hazardous conditions' };
};

// Create custom marker icon
const createMarkerIcon = (aqi) => {
  const color = getAQIColor(aqi);
  return L.divIcon({
    className: 'custom-aqi-marker',
    html: `
      <div style="
        background: ${color};
        width: 32px;
        height: 32px;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        border: 3px solid white;
        box-shadow: 0 3px 10px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <span style="
          transform: rotate(45deg);
          color: white;
          font-weight: bold;
          font-size: 11px;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        ">${aqi}</span>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  });
};

// Component to handle map events and fetch stations
const MapEventHandler = ({ onBoundsChange, showHeatmap }) => {
  const map = useMapEvents({
    moveend: () => {
      const bounds = map.getBounds();
      onBoundsChange(bounds);
    },
    zoomend: () => {
      const bounds = map.getBounds();
      onBoundsChange(bounds);
    }
  });
  
  // Trigger initial load
  useEffect(() => {
    const bounds = map.getBounds();
    onBoundsChange(bounds);
  }, []);
  
  return null;
};

// Heatmap Layer Component - creates colored areas on the map
const HeatmapLayer = ({ stations }) => {
  const map = useMap();
  const heatmapLayerRef = useRef(null);
  
  useEffect(() => {
    if (!map || !stations || stations.length === 0) return;
    
    // Remove existing heatmap layer if any
    if (heatmapLayerRef.current) {
      map.removeLayer(heatmapLayerRef.current);
    }
    
    // Prepare heatmap data with normalized intensity based on AQI
    // AQI values: 0-1000, normalize to 0-1 for heatmap intensity
    const heatmapData = stations.map(station => {
      // Normalize AQI to 0-1 range (0 = good, 1 = hazardous)
      const normalizedIntensity = Math.min(station.aqi / 500, 1); // Cap at 500 for better visualization
      return [station.lat, station.lon, normalizedIntensity];
    });
    
    // Create heatmap layer with custom gradient matching our AQI colors
    const heatLayer = L.heatLayer(heatmapData, {
      radius: 40,
      blur: 35,
      maxZoom: 17,
      max: 1.0,
      minOpacity: 0.5,
      // Custom gradient: green → yellow → orange → red
      gradient: {
        0.0: '#00b050',   // Green (Good AQI 0-50)
        0.2: '#92d050',   // Light green (AQI 50-100)
        0.4: '#ffff66',   // Yellow (AQI 100-200)
        0.6: '#ff9900',   // Orange (AQI 200-300)
        0.8: '#ff3300',   // Red-orange (AQI 300-400)
        1.0: '#990000'    // Deep red (AQI 400-500+)
      }
    }).addTo(map);
    
    heatmapLayerRef.current = heatLayer;
    
    // Cleanup on unmount
    return () => {
      if (heatmapLayerRef.current && map) {
        map.removeLayer(heatmapLayerRef.current);
      }
    };
  }, [map, stations]);
  
  return null;
};

// Search component
const SearchBar = ({ onSelectLocation }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef(null);
  
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const searchLocation = async (searchQuery) => {
    if (searchQuery.length < 2) {
      setResults([]);
      return;
    }
    
    setIsSearching(true);
    try {
      // Try WAQI search first
      const waqiResponse = await axios.get(`${API}/aqi/search`, {
        params: { query: searchQuery }
      });
      
      if (waqiResponse.data.results && waqiResponse.data.results.length > 0) {
        setResults(waqiResponse.data.results.map(r => ({
          name: r.name,
          lat: r.lat,
          lon: r.lon,
          aqi: r.aqi,
          source: 'waqi'
        })));
        setShowResults(true);
      } else {
        // Fallback to Nominatim geocoding
        const nominatimResponse = await axios.get('https://nominatim.openstreetmap.org/search', {
          params: {
            q: searchQuery + ', India',
            format: 'json',
            limit: 5,
            countrycodes: 'in'
          },
          headers: {
            'User-Agent': 'AQI-Map-India-App'
          }
        });
        
        setResults(nominatimResponse.data.map(r => ({
          name: r.display_name,
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon),
          source: 'nominatim'
        })));
        setShowResults(true);
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error('Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };
  
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query) {
        searchLocation(query);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [query]);
  
  return (
    <div ref={searchRef} className="relative" data-testid="search-container">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <Input
          data-testid="search-input"
          type="text"
          placeholder="Search for a city in India..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setShowResults(true)}
          className="pl-10 pr-4 py-3 w-full rounded-xl border-2 border-gray-200 focus:border-blue-500 transition-colors bg-white shadow-lg"
        />
        {isSearching && (
          <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 animate-spin text-blue-500 w-5 h-5" />
        )}
      </div>
      
      {showResults && results.length > 0 && (
        <Card className="absolute top-full mt-2 w-full max-h-80 overflow-y-auto z-50 shadow-2xl" data-testid="search-results">
          {results.map((result, idx) => (
            <div
              key={idx}
              data-testid={`search-result-${idx}`}
              className="p-3 hover:bg-blue-50 cursor-pointer border-b last:border-b-0 transition-colors"
              onClick={() => {
                onSelectLocation(result.lat, result.lon, result.name);
                setShowResults(false);
                setQuery('');
              }}
            >
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-blue-500 mt-1 flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-medium text-sm">{result.name}</div>
                  {result.aqi && result.aqi !== '-' && (
                    <div className="text-xs text-gray-500 mt-1">
                      AQI: <span className="font-semibold" style={{ color: getAQIColor(parseInt(result.aqi)) }}>{result.aqi}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
};

// Legend component
const AQILegend = () => {
  const legendStops = [
    { value: 0, label: '0-50', color: getAQIColor(25), category: 'Good' },
    { value: 50, label: '50-100', color: getAQIColor(75), category: 'Moderate' },
    { value: 100, label: '100-250', color: getAQIColor(175), category: 'Unhealthy (Sensitive)' },
    { value: 250, label: '250-500', color: getAQIColor(375), category: 'Unhealthy' },
    { value: 500, label: '500-750', color: getAQIColor(625), category: 'Very Unhealthy' },
    { value: 750, label: '750-1000', color: getAQIColor(875), category: 'Hazardous' }
  ];
  
  return (
    <Card className="p-4 shadow-xl" data-testid="aqi-legend">
      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <Wind className="w-4 h-4" />
        AQI Scale (0-1000)
      </h3>
      <div className="space-y-2">
        {legendStops.map((stop, idx) => (
          <div key={idx} className="flex items-center gap-3" data-testid={`legend-item-${idx}`}>
            <div
              className="w-8 h-8 rounded-full border-2 border-white shadow-md flex-shrink-0"
              style={{ backgroundColor: stop.color }}
            />
            <div className="text-xs">
              <div className="font-semibold">{stop.label}</div>
              <div className="text-gray-500">{stop.category}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t text-xs text-gray-500">
        <p>Data updates every 10 minutes</p>
        <p className="mt-1">Source: WAQI (World Air Quality Index)</p>
      </div>
    </Card>
  );
};

// Main App
function App() {
  const [stations, setStations] = useState([]);
  const [selectedStation, setSelectedStation] = useState(null);
  const [mapCenter, setMapCenter] = useState([20.5937, 78.9629]); // India center
  const [mapZoom, setMapZoom] = useState(5);
  const [loading, setLoading] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  
  const fetchStations = async (bounds) => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/aqi/bounds`, {
        params: {
          nelat: bounds.getNorthEast().lat,
          nelng: bounds.getNorthEast().lng,
          swlat: bounds.getSouthWest().lat,
          swlng: bounds.getSouthWest().lng
        }
      });
      
      if (response.data.stations) {
        setStations(response.data.stations);
      }
    } catch (error) {
      console.error('Error fetching stations:', error);
      toast.error('Failed to load AQI data');
    } finally {
      setLoading(false);
    }
  };
  
  const handleSelectLocation = async (lat, lon, name) => {
    setMapCenter([lat, lon]);
    setMapZoom(11);
    
    try {
      const response = await axios.get(`${API}/aqi/geo`, {
        params: { lat, lng: lon }
      });
      
      if (response.data) {
        setSelectedStation(response.data);
        toast.success(`Showing AQI for ${name}`);
      }
    } catch (error) {
      toast.error('No AQI data available for this location');
    }
  };
  
  return (
    <div className="App h-screen flex flex-col" data-testid="app-container">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 text-white p-4 shadow-lg z-10">
        <div className="container mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            India Air Quality Map
          </h1>
          <p className="text-sm text-blue-50">Real-time AQI monitoring across India</p>
        </div>
      </header>
      
      {/* Main content */}
      <div className="flex-1 relative">
        {/* Search bar - floating */}
        <div className="absolute top-4 left-4 right-4 sm:left-4 sm:right-auto sm:w-96 z-[1000]">
          <SearchBar onSelectLocation={handleSelectLocation} />
        </div>
        
        {/* Legend - floating */}
        <div className="hidden lg:block absolute bottom-4 left-4 z-[1000]">
          <AQILegend />
        </div>
        
        {/* Toggle heatmap button */}
        <div className="absolute top-4 right-4 z-[1000]">
          <Button
            data-testid="toggle-heatmap-btn"
            onClick={() => setShowHeatmap(!showHeatmap)}
            variant={showHeatmap ? 'default' : 'outline'}
            className="shadow-lg bg-white hover:bg-gray-50"
          >
            <Layers className="w-4 h-4 mr-2" />
            {showHeatmap ? 'Show Markers' : 'Show Heatmap'}
          </Button>
        </div>
        
        {/* Loading indicator */}
        {loading && (
          <div className="absolute top-20 right-4 z-[1000] bg-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            <span className="text-sm">Loading AQI data...</span>
          </div>
        )}
        
        {/* Map */}
        <MapContainer
          center={mapCenter}
          zoom={mapZoom}
          className="h-full w-full"
          zoomControl={true}
          data-testid="map-container"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          
          <MapEventHandler onBoundsChange={fetchStations} showHeatmap={showHeatmap} />
          
          {/* Heatmap Layer - shows colored areas on the map */}
          {showHeatmap && <HeatmapLayer stations={stations} />}
          
          {/* Station markers */}
          {!showHeatmap && stations.map((station) => (
            <Marker
              key={station.uid}
              position={[station.lat, station.lon]}
              icon={createMarkerIcon(station.aqi)}
              data-testid={`marker-${station.uid}`}
            >
              <Popup data-testid={`popup-${station.uid}`}>
                <div className="p-2">
                  <h3 className="font-bold text-base mb-2">{station.name}</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">AQI:</span>
                      <span
                        className="px-2 py-1 rounded font-bold text-white"
                        style={{ backgroundColor: getAQIColor(station.aqi) }}
                      >
                        {station.aqi}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold">Status:</span> {getAQICategory(station.aqi).label}
                    </div>
                    <div className="text-xs text-gray-600 mt-2">
                      {getAQICategory(station.aqi).description}
                    </div>
                    <a
                      href={station.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-xs block mt-2"
                    >
                      View detailed report →
                    </a>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        
        {/* Mobile legend */}
        <div className="lg:hidden absolute bottom-0 left-0 right-0 bg-white border-t z-[1000] max-h-48 overflow-y-auto">
          <AQILegend />
        </div>
      </div>
    </div>
  );
}

export default App;