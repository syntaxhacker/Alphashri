import { useState, useEffect } from 'react'
import { Search, TrendingUp } from 'lucide-react'

const StockSearch = ({ onStockSelect }) => {
  const [stocks, setStocks] = useState([])
  const [filteredStocks, setFilteredStocks] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchStocks()
  }, [])

  useEffect(() => {
    if (searchTerm) {
      const filtered = stocks.filter(stock =>
        stock.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
        stock.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
      setFilteredStocks(filtered)
    } else {
      setFilteredStocks(stocks)
    }
  }, [searchTerm, stocks])

  const fetchStocks = async () => {
    setLoading(true)
    try {
      const response = await fetch('http://localhost:8000/stocks')
      if (response.ok) {
        const stocksData = await response.json()
        setStocks(stocksData)
        setFilteredStocks(stocksData)
      }
    } catch (error) {
      console.error('Failed to fetch stocks:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleStockClick = (stock) => {
    onStockSelect(stock)
  }

  return (
    <div className="stock-search">
      <div className="search-input">
        <Search size={18} className="search-icon" />
        <input
          type="text"
          placeholder="Search stocks (e.g., TATA, Reliance)..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading">Loading stocks...</div>
      ) : (
        <div className="stocks-list">
          {filteredStocks.map((stock) => (
            <div
              key={stock.symbol}
              className="stock-item"
              onClick={() => handleStockClick(stock)}
            >
              <div className="stock-main">
                <div className="stock-symbol">
                  <TrendingUp size={16} />
                  {stock.symbol}
                </div>
                <div className="stock-name">{stock.name}</div>
              </div>
              <div className="stock-meta">
                <span className="exchange">{stock.exchange}</span>
                {stock.files && stock.files.length > 0 && (
                  <span className="files-count">
                    {stock.files.length} file{stock.files.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          ))}
          
          {filteredStocks.length === 0 && !loading && (
            <div className="no-results">
              No stocks found matching "{searchTerm}"
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default StockSearch 