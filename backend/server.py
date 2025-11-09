from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import requests
from functools import lru_cache
import time


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# WAQI API configuration
WAQI_API_TOKEN = os.environ.get('WAQI_API_TOKEN')
WAQI_BASE_URL = "https://api.waqi.info"

# Simple in-memory cache
cache_store = {}
CACHE_TTL = 600  # 10 minutes

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str

class AQIStation(BaseModel):
    uid: int
    name: str
    lat: float
    lon: float
    aqi: int
    url: str

class AQIDetail(BaseModel):
    aqi: int
    idx: int
    city_name: str
    dominant_pollutant: Optional[str] = None
    timestamp: str
    station_name: str
    lat: float
    lon: float
    pollutants: Optional[Dict[str, Any]] = None
    url: str


# Cache helper functions
def get_cache(key: str):
    if key in cache_store:
        data, expiry = cache_store[key]
        if time.time() < expiry:
            return data
        else:
            del cache_store[key]
    return None

def set_cache(key: str, value: Any):
    cache_store[key] = (value, time.time() + CACHE_TTL)


# WAQI API wrapper functions
def fetch_waqi_api(endpoint: str, params: dict = None):
    """Fetch data from WAQI API with error handling"""
    try:
        if params is None:
            params = {}
        params['token'] = WAQI_API_TOKEN
        
        response = requests.get(f"{WAQI_BASE_URL}/{endpoint}", params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if data.get('status') != 'ok':
            raise HTTPException(status_code=400, detail=f"WAQI API error: {data.get('data', 'Unknown error')}")
        
        return data.get('data')
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=503, detail=f"Failed to fetch AQI data: {str(e)}")


# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "AQI Map API"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.model_dump()
    status_obj = StatusCheck(**status_dict)
    
    doc = status_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    
    _ = await db.status_checks.insert_one(doc)
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    
    for check in status_checks:
        if isinstance(check['timestamp'], str):
            check['timestamp'] = datetime.fromisoformat(check['timestamp'])
    
    return status_checks


# AQI Endpoints
@api_router.get("/aqi/city")
async def get_aqi_by_city(name: str = Query(..., description="City name to search")):
    """Get AQI data for a specific city by name"""
    cache_key = f"city_{name.lower()}"
    cached = get_cache(cache_key)
    if cached:
        return cached
    
    data = fetch_waqi_api(f"feed/{name}/")
    
    if isinstance(data, str):
        raise HTTPException(status_code=404, detail="City not found or no AQI data available")
    
    result = {
        "aqi": data.get('aqi', -1),
        "idx": data.get('idx', 0),
        "city_name": data.get('city', {}).get('name', name),
        "dominant_pollutant": data.get('dominentpol'),
        "timestamp": data.get('time', {}).get('iso', ''),
        "station_name": data.get('city', {}).get('name', ''),
        "lat": data.get('city', {}).get('geo', [0, 0])[0],
        "lon": data.get('city', {}).get('geo', [0, 0])[1],
        "pollutants": data.get('iaqi', {}),
        "url": data.get('city', {}).get('url', '')
    }
    
    set_cache(cache_key, result)
    return result

@api_router.get("/aqi/geo")
async def get_aqi_by_geo(lat: float = Query(...), lng: float = Query(...)):
    """Get nearest AQI station data by coordinates"""
    cache_key = f"geo_{lat:.3f}_{lng:.3f}"
    cached = get_cache(cache_key)
    if cached:
        return cached
    
    data = fetch_waqi_api(f"feed/geo:{lat};{lng}/")
    
    if isinstance(data, str) or data.get('aqi') == '-':
        raise HTTPException(status_code=404, detail="No AQI data available for this location")
    
    result = {
        "aqi": int(data.get('aqi', -1)) if data.get('aqi') != '-' else -1,
        "idx": data.get('idx', 0),
        "city_name": data.get('city', {}).get('name', 'Unknown'),
        "dominant_pollutant": data.get('dominentpol'),
        "timestamp": data.get('time', {}).get('iso', ''),
        "station_name": data.get('city', {}).get('name', ''),
        "lat": data.get('city', {}).get('geo', [lat, lng])[0],
        "lon": data.get('city', {}).get('geo', [lat, lng])[1],
        "pollutants": data.get('iaqi', {}),
        "url": data.get('city', {}).get('url', '')
    }
    
    set_cache(cache_key, result)
    return result

@api_router.get("/aqi/bounds")
async def get_aqi_stations_in_bounds(
    nelat: float = Query(..., description="Northeast latitude"),
    nelng: float = Query(..., description="Northeast longitude"),
    swlat: float = Query(..., description="Southwest latitude"),
    swlng: float = Query(..., description="Southwest longitude")
):
    """Get all AQI monitoring stations within map bounds"""
    cache_key = f"bounds_{nelat:.2f}_{nelng:.2f}_{swlat:.2f}_{swlng:.2f}"
    cached = get_cache(cache_key)
    if cached:
        return cached
    
    # WAQI map bounds endpoint
    data = fetch_waqi_api("map/bounds/", {
        "latlng": f"{swlat},{swlng},{nelat},{nelng}"
    })
    
    stations = []
    if isinstance(data, list):
        for station in data:
            # Filter valid stations with AQI data
            if station.get('aqi') and station.get('aqi') != '-':
                try:
                    aqi_val = int(station['aqi'])
                    if aqi_val > 0:  # Only include valid positive AQI values
                        stations.append({
                            "uid": station.get('uid', 0),
                            "name": station.get('station', {}).get('name', 'Unknown'),
                            "lat": station.get('lat', 0),
                            "lon": station.get('lon', 0),
                            "aqi": aqi_val,
                            "url": f"https://aqicn.org/station/@{station.get('uid', 0)}/"
                        })
                except (ValueError, TypeError):
                    continue
    
    result = {"stations": stations, "count": len(stations)}
    set_cache(cache_key, result)
    return result

@api_router.get("/aqi/search")
async def search_city(query: str = Query(..., min_length=2)):
    """Search for cities with AQI monitoring stations"""
    # Use WAQI search endpoint
    data = fetch_waqi_api("search/", {"keyword": query})
    
    results = []
    if isinstance(data, list):
        for item in data[:10]:  # Limit to 10 results
            results.append({
                "uid": item.get('uid', 0),
                "name": item.get('station', {}).get('name', ''),
                "aqi": item.get('aqi', '-'),
                "time": item.get('time', {}).get('stime', ''),
                "lat": item.get('station', {}).get('geo', [0, 0])[0],
                "lon": item.get('station', {}).get('geo', [0, 0])[1]
            })
    
    return {"results": results}


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()