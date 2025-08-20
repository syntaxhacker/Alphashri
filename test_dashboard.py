#!/usr/bin/env python3
"""
Simple test to verify the web dashboard is accessible
"""

import requests
import json
from rich.console import Console

console = Console()

def test_endpoints():
    """Test all Flask endpoints"""
    base_url = "http://localhost:8080"
    
    endpoints = [
        ("/api/health", "Health Check"),
        ("/api/status", "Bot Status"),
        ("/", "Dashboard")
    ]
    
    console.print("🌐 Testing Flask Endpoints", style="bold blue")
    console.print("=" * 50)
    
    for endpoint, name in endpoints:
        try:
            url = f"{base_url}{endpoint}"
            response = requests.get(url, timeout=5)
            
            if response.status_code == 200:
                console.print(f"✅ {name}: [green]{response.status_code}[/green]")
                
                if endpoint != "/":  # Don't print HTML content
                    try:
                        data = response.json()
                        console.print(f"   📊 {json.dumps(data, indent=2)}")
                    except:
                        console.print(f"   📄 Content length: {len(response.text)} characters")
                else:
                    console.print(f"   📄 HTML Dashboard loaded ({len(response.text)} characters)")
            else:
                console.print(f"❌ {name}: [red]{response.status_code}[/red]")
                
        except requests.exceptions.ConnectionError:
            console.print(f"❌ {name}: [red]Connection refused - Is Flask app running?[/red]")
        except Exception as e:
            console.print(f"❌ {name}: [red]{e}[/red]")
    
    console.print("\n🔗 Access the dashboard at: [link]http://localhost:8080[/link]")

if __name__ == "__main__":
    test_endpoints()