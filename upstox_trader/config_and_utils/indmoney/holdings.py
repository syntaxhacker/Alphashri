"""
Holdings data fetching for INDMoney.
"""

from typing import Optional

import pandas as pd


class HoldingsMixin:

    def fetch_holdings(self) -> Optional[pd.DataFrame]:
        url = f"{self.BASE_URL}/portfolio/holdings"

        try:
            headers = self._get_headers()
            response = requests.get(url, headers=headers, timeout=15)

            if response.status_code in [401, 403]:
                self._handle_api_error(response)

            response.raise_for_status()
            data = response.json()

            if data.get('status') == 'success' and 'data' in data:
                holdings = data['data']
                if isinstance(holdings, list) and len(holdings) > 0:
                    df = pd.DataFrame(holdings)
                    self._log(f"✅ Fetched {len(df)} holdings")
                    return df

            self._log("ℹ️  No holdings found")
            return pd.DataFrame()

        except ValueError:
            raise
        except Exception as e:
            self._log(f"❌ Failed to fetch holdings: {e}")
            return pd.DataFrame()
