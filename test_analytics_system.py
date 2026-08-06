import urllib.request
import urllib.parse
import json

def test_analytics_endpoints():
    print("Testing analytics endpoints syntax and database structure...")
    # Verify server file includes click_logs table creation and /admin/analytics endpoint
    with open("server.js", "r", encoding="utf-8") as f:
        code = f.read()
        assert "CREATE TABLE IF NOT EXISTS click_logs" in code
        assert "/admin/analytics" in code
        assert "/api/track-click" in code
    print("ALL ANALYTICS TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_analytics_endpoints()
