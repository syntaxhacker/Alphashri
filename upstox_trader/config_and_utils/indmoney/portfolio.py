"""
Portfolio data fetching for INDMoney: user profile, funds, holdings, positions.
"""

from typing import Dict, Optional

import pandas as pd
import requests


class PortfolioMixin:

    def fetch_user_profile(self) -> Optional[Dict]:
        url = f"{self.BASE_URL}/user/profile"
        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            return response.json()
        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ INDMoney Profile Error: {e}")
            return None

    def fetch_funds(self) -> Optional[Dict]:
        url = f"{self.BASE_URL}/funds"
        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            return response.json()
        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ INDMoney Funds Error: {e}")
            return None

    def fetch_positions(self) -> Optional[pd.DataFrame]:
        url = f"{self.BASE_URL}/portfolio/positions"

        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            data = response.json()

            if data.get('status') == 'success' and 'data' in data:
                positions = data['data']
                if isinstance(positions, list) and len(positions) > 0:
                    df = pd.DataFrame(positions)
                    self._log(f"✅ Fetched {len(df)} positions")
                    return df

            self._log("ℹ️  No open positions found")
            return pd.DataFrame()

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Failed to fetch positions: {e}")
            return pd.DataFrame()
