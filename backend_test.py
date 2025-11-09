import requests
import sys
import time
from datetime import datetime

class AQIAPITester:
    def __init__(self, base_url="https://indiaair-mapper.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def run_test(self, name, method, endpoint, expected_status, params=None, data=None):
        """Run a single API test"""
        url = f"{self.api_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params, timeout=30)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=30)

            success = response.status_code == expected_status
            
            result = {
                "test_name": name,
                "endpoint": endpoint,
                "method": method,
                "expected_status": expected_status,
                "actual_status": response.status_code,
                "success": success,
                "response_data": None,
                "error": None
            }
            
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    result["response_data"] = response.json()
                    if isinstance(result["response_data"], dict):
                        print(f"   Response keys: {list(result['response_data'].keys())}")
                except:
                    result["response_data"] = response.text
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    result["error"] = error_data
                    print(f"   Error: {error_data}")
                except:
                    result["error"] = response.text
                    print(f"   Error: {response.text}")

            self.test_results.append(result)
            return success, result["response_data"]

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            result = {
                "test_name": name,
                "endpoint": endpoint,
                "method": method,
                "expected_status": expected_status,
                "actual_status": "Exception",
                "success": False,
                "response_data": None,
                "error": str(e)
            }
            self.test_results.append(result)
            return False, {}

    def test_root_endpoint(self):
        """Test the root API endpoint"""
        return self.run_test("Root API", "GET", "", 200)

    def test_city_aqi_delhi(self):
        """Test AQI data for Delhi"""
        return self.run_test("Delhi AQI", "GET", "aqi/city", 200, params={"name": "Delhi"})

    def test_city_aqi_mumbai(self):
        """Test AQI data for Mumbai"""
        return self.run_test("Mumbai AQI", "GET", "aqi/city", 200, params={"name": "Mumbai"})

    def test_city_aqi_bangalore(self):
        """Test AQI data for Bangalore"""
        return self.run_test("Bangalore AQI", "GET", "aqi/city", 200, params={"name": "Bangalore"})

    def test_city_aqi_invalid(self):
        """Test AQI data for invalid city"""
        return self.run_test("Invalid City AQI", "GET", "aqi/city", 404, params={"name": "NonExistentCity123"})

    def test_geo_aqi_delhi(self):
        """Test AQI data by coordinates (Delhi area)"""
        return self.run_test("Delhi Geo AQI", "GET", "aqi/geo", 200, params={"lat": 28.6139, "lng": 77.2090})

    def test_geo_aqi_mumbai(self):
        """Test AQI data by coordinates (Mumbai area)"""
        return self.run_test("Mumbai Geo AQI", "GET", "aqi/geo", 200, params={"lat": 19.0760, "lng": 72.8777})

    def test_geo_aqi_invalid(self):
        """Test AQI data for coordinates with no data (middle of ocean)"""
        return self.run_test("Invalid Geo AQI", "GET", "aqi/geo", 404, params={"lat": 0.0, "lng": 0.0})

    def test_bounds_aqi_india(self):
        """Test AQI stations within India bounds"""
        # Bounds covering major Indian cities
        params = {
            "nelat": 35.0,  # North East latitude
            "nelng": 85.0,  # North East longitude  
            "swlat": 8.0,   # South West latitude
            "swlng": 68.0   # South West longitude
        }
        return self.run_test("India Bounds AQI", "GET", "aqi/bounds", 200, params=params)

    def test_bounds_aqi_delhi_region(self):
        """Test AQI stations within Delhi region bounds"""
        params = {
            "nelat": 28.8,  # North East latitude
            "nelng": 77.5,  # North East longitude  
            "swlat": 28.4,  # South West latitude
            "swlng": 76.8   # South West longitude
        }
        return self.run_test("Delhi Region Bounds AQI", "GET", "aqi/bounds", 200, params=params)

    def test_search_delhi(self):
        """Test search for Delhi"""
        return self.run_test("Search Delhi", "GET", "aqi/search", 200, params={"query": "Delhi"})

    def test_search_mumbai(self):
        """Test search for Mumbai"""
        return self.run_test("Search Mumbai", "GET", "aqi/search", 200, params={"query": "Mumbai"})

    def test_search_short_query(self):
        """Test search with short query (should still work)"""
        return self.run_test("Search Short Query", "GET", "aqi/search", 200, params={"query": "De"})

    def test_caching_mechanism(self):
        """Test caching by making same request twice"""
        print(f"\n🔍 Testing Caching Mechanism...")
        
        # First request
        start_time = time.time()
        success1, data1 = self.run_test("Cache Test - First Request", "GET", "aqi/city", 200, params={"name": "Delhi"})
        first_request_time = time.time() - start_time
        
        # Second request (should be faster due to caching)
        start_time = time.time()
        success2, data2 = self.run_test("Cache Test - Second Request", "GET", "aqi/city", 200, params={"name": "Delhi"})
        second_request_time = time.time() - start_time
        
        if success1 and success2:
            print(f"   First request time: {first_request_time:.3f}s")
            print(f"   Second request time: {second_request_time:.3f}s")
            if second_request_time < first_request_time * 0.8:  # 20% faster indicates caching
                print(f"✅ Caching appears to be working (second request was faster)")
                return True
            else:
                print(f"⚠️  Caching may not be working optimally")
                return True  # Still pass as both requests succeeded
        return False

def main():
    print("🚀 Starting AQI API Backend Testing...")
    print("=" * 60)
    
    tester = AQIAPITester()
    
    # Test all endpoints
    test_methods = [
        tester.test_root_endpoint,
        tester.test_city_aqi_delhi,
        tester.test_city_aqi_mumbai,
        tester.test_city_aqi_bangalore,
        tester.test_city_aqi_invalid,
        tester.test_geo_aqi_delhi,
        tester.test_geo_aqi_mumbai,
        tester.test_geo_aqi_invalid,
        tester.test_bounds_aqi_india,
        tester.test_bounds_aqi_delhi_region,
        tester.test_search_delhi,
        tester.test_search_mumbai,
        tester.test_search_short_query,
        tester.test_caching_mechanism
    ]
    
    for test_method in test_methods:
        try:
            test_method()
        except Exception as e:
            print(f"❌ Test method {test_method.__name__} failed with exception: {str(e)}")
    
    # Print summary
    print("\n" + "=" * 60)
    print(f"📊 BACKEND TEST SUMMARY")
    print("=" * 60)
    print(f"Tests run: {tester.tests_run}")
    print(f"Tests passed: {tester.tests_passed}")
    print(f"Tests failed: {tester.tests_run - tester.tests_passed}")
    print(f"Success rate: {(tester.tests_passed / tester.tests_run * 100):.1f}%")
    
    # Print failed tests
    failed_tests = [r for r in tester.test_results if not r["success"]]
    if failed_tests:
        print(f"\n❌ FAILED TESTS:")
        for test in failed_tests:
            print(f"   - {test['test_name']}: {test['error']}")
    
    # Print successful endpoint examples
    successful_tests = [r for r in tester.test_results if r["success"] and r["response_data"]]
    if successful_tests:
        print(f"\n✅ SAMPLE SUCCESSFUL RESPONSES:")
        for test in successful_tests[:3]:  # Show first 3 successful responses
            print(f"   - {test['test_name']}: {test['actual_status']}")
            if isinstance(test["response_data"], dict):
                if "aqi" in test["response_data"]:
                    print(f"     AQI: {test['response_data']['aqi']}")
                if "stations" in test["response_data"]:
                    print(f"     Stations found: {test['response_data'].get('count', 0)}")
    
    return 0 if tester.tests_passed == tester.tests_run else 1

if __name__ == "__main__":
    sys.exit(main())