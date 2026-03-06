import { Stack, Alert, Container } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useState, useMemo } from 'react';
import { ScreenerNav } from './ScreenerNav';
import { ScreenerHeader } from './ScreenerHeader';
import { ScreenerFilters } from './ScreenerFilters';
import { ScreenerSummary } from './ScreenerSummary';
import { ScreenerTable } from './ScreenerTable';
import { ScreenerEmpty } from './ScreenerEmpty';
import { ScreenerLoading } from './ScreenerLoading';
import { TradingList } from './TradingList';
import { getColumnsForScreener } from './columns';

interface ProfileFilterDef {
  key: string;
  label: string;
  type: 'number' | 'select';
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
}

interface Stock {
  symbol: string;
  score: number;
  sector: string;
  [key: string]: any;
}

interface ScreenerPageProps {
  screenerOptions: Array<{ id: string; label: string; description?: string }>;
  activeScreener: string;
  onScreenerChange: (id: string) => void;
  
  title: string;
  status: string;
  isLoading: boolean;
  autoRefreshSeconds: number;
  provider: string;
  mode: string;
  onRefresh: () => void;
  onAutoRefreshChange: (value: number) => void;
  onProviderChange: (value: string) => void;
  onModeChange: (value: string) => void;
  
  filters: {
    minScore: number;
    maxPrice: number;
    minReturn: number;
    sector: string;
    [key: string]: any;
  };
  sectors: string[];
  profileFilters?: ProfileFilterDef[];
  onFilterChange: (key: string, value: any) => void;
  onResetFilters: () => void;
  
  stocks: Stock[];
  touchedSymbols: Set<string>;
  summary?: Array<{ label: string; value: string | number; color?: string }>;
  
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
  
  error?: string | null;
}

export function ScreenerPage({
  screenerOptions,
  activeScreener,
  onScreenerChange,
  title,
  status,
  isLoading,
  autoRefreshSeconds,
  provider,
  mode,
  onRefresh,
  onAutoRefreshChange,
  onProviderChange,
  onModeChange,
  filters,
  sectors,
  profileFilters,
  onFilterChange,
  onResetFilters,
  stocks,
  touchedSymbols,
  summary,
  onSymbolClick,
  onSymbolHover,
  error,
}: ScreenerPageProps) {
  const [sortColumn, setSortColumn] = useState<string | null>('score');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const sortedStocks = useMemo(() => {
    if (!sortColumn) return stocks;
    
    return [...stocks].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      
      const comparison = aVal < bVal ? -1 : 1;
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [stocks, sortColumn, sortDirection]);

  const handleSortChange = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const columns = getColumnsForScreener(activeScreener);

  const renderContent = () => {
    if (isLoading) {
      return <ScreenerLoading />;
    }

    if (error) {
      return (
        <Alert 
          icon={<IconAlertCircle size={16} />} 
          title="Error" 
          color="red" 
          variant="filled"
        >
          {error}
        </Alert>
      );
    }

    if (sortedStocks.length === 0) {
      return <ScreenerEmpty />;
    }

    return (
      <ScreenerTable
        stocks={sortedStocks}
        columns={columns}
        touchedSymbols={touchedSymbols}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={handleSortChange}
        onSymbolClick={onSymbolClick}
        onSymbolHover={onSymbolHover}
        screenerType={activeScreener}
      />
    );
  };

  return (
    <Container size="xl" py="md">
      <Stack gap="md">
        <ScreenerNav
          options={screenerOptions}
          activeScreener={activeScreener}
          onChange={onScreenerChange}
        />

        <ScreenerHeader
          title={title}
          status={status}
          isLoading={isLoading}
          autoRefreshSeconds={autoRefreshSeconds}
          provider={provider}
          mode={mode}
          onRefresh={onRefresh}
          onAutoRefreshChange={onAutoRefreshChange}
          onProviderChange={onProviderChange}
          onModeChange={onModeChange}
        />

        <ScreenerFilters
          minScore={filters.minScore}
          maxPrice={filters.maxPrice}
          minReturn={filters.minReturn}
          sector={filters.sector}
          sectors={sectors}
          profileFilters={profileFilters}
          profileFilterValues={filters}
          onFilterChange={onFilterChange}
          onReset={onResetFilters}
        />

        {summary && <ScreenerSummary summary={summary} />}

        {renderContent()}

        <TradingList symbols={sortedStocks.map(s => s.symbol)} />
      </Stack>
    </Container>
  );
}
