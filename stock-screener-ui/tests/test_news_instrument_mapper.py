"""
Tests for NewsInstrumentMapper service.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from services.news_instrument_mapper import (
    NewsInstrumentMapper,
    MappingResult,
    get_mapper,
    map_news_symbol,
    map_news_symbols,
)


@pytest.fixture
def sample_instruments():
    return [
        {
            'trading_symbol': 'RELIANCE',
            'instrument_key': 'NSE_EQ|INE002A01018',
            'name': 'Reliance Industries Ltd',
            'segment': 'NSE_EQ',
            'instrument_type': 'EQ'
        },
        {
            'trading_symbol': 'TCS',
            'instrument_key': 'NSE_EQ|INE467B01029',
            'name': 'Tata Consultancy Services Ltd',
            'segment': 'NSE_EQ',
            'instrument_type': 'EQ'
        },
        {
            'trading_symbol': 'TATAMOTORS',
            'instrument_key': 'NSE_EQ|INE715A01026',
            'name': 'Tata Motors Ltd',
            'segment': 'NSE_EQ',
            'instrument_type': 'EQ'
        },
        {
            'trading_symbol': 'MM',
            'instrument_key': 'NSE_EQ|INE554A01019',
            'name': 'Mahindra & Mahindra Ltd',
            'segment': 'NSE_EQ',
            'instrument_type': 'EQ'
        },
        {
            'trading_symbol': 'LT',
            'instrument_key': 'NSE_EQ|INE018A01030',
            'name': 'Larsen & Toubro Ltd',
            'segment': 'NSE_EQ',
            'instrument_type': 'EQ'
        },
        {
            'trading_symbol': 'INFY',
            'instrument_key': 'NSE_EQ|INE009A01021',
            'name': 'Infosys Ltd',
            'segment': 'NSE_EQ',
            'instrument_type': 'EQ'
        },
        {
            'trading_symbol': 'HDFCBANK',
            'instrument_key': 'NSE_EQ|INE040A01034',
            'name': 'HDFC Bank Ltd',
            'segment': 'NSE_EQ',
            'instrument_type': 'EQ'
        },
    ]


@pytest.fixture
def mapper(sample_instruments):
    """Create mapper with sample instruments."""
    with patch.object(NewsInstrumentMapper, '_try_default_paths'):
        with patch.object(NewsInstrumentMapper, '_init_embeddings'):
            m = NewsInstrumentMapper(fuzzy_threshold=0.8, use_embeddings=False)
            m.instruments = sample_instruments
            m.symbol_to_instrument = {
                inst['trading_symbol']: inst for inst in sample_instruments
            }
            return m


class TestMappingResult:
    def test_to_dict(self):
        result = MappingResult(
            original_code='RELIANCE',
            trading_symbol='RELIANCE',
            instrument_key='NSE_EQ|INE002A01018',
            company_name='Reliance Industries Ltd',
            confidence=1.0,
            method='exact'
        )
        
        d = result.to_dict()
        
        assert d['original_code'] == 'RELIANCE'
        assert d['trading_symbol'] == 'RELIANCE'
        assert d['instrument_key'] == 'NSE_EQ|INE002A01018'
        assert d['confidence'] == 1.0
        assert d['method'] == 'exact'
    
    def test_is_mapped_true(self):
        result = MappingResult(
            original_code='RELIANCE',
            trading_symbol='RELIANCE',
            instrument_key='NSE_EQ|INE002A01018',
            company_name='Reliance',
            confidence=1.0,
            method='exact'
        )
        assert result.is_mapped is True
    
    def test_is_mapped_false(self):
        result = MappingResult(
            original_code='UNKNOWN',
            trading_symbol=None,
            instrument_key=None,
            company_name=None,
            confidence=0.0,
            method='none'
        )
        assert result.is_mapped is False


class TestNewsInstrumentMapper:
    def test_exact_match(self, mapper):
        result = mapper.map_symbol('RELIANCE')
        
        assert result.is_mapped
        assert result.trading_symbol == 'RELIANCE'
        assert result.method == 'exact'
        assert result.confidence == 1.0
    
    def test_exact_match_case_insensitive(self, mapper):
        result = mapper.map_symbol('reliance')
        
        assert result.is_mapped
        assert result.trading_symbol == 'RELIANCE'
        assert result.method == 'exact'
    
    def test_exact_match_with_suffix(self, mapper):
        result = mapper.map_symbol('RELIANCE.NS')
        
        assert result.is_mapped
        assert result.trading_symbol == 'RELIANCE'
    
    def test_variation_match_m_and_m(self, mapper):
        result = mapper.map_symbol('M&M')
        
        assert result.is_mapped
        assert result.trading_symbol == 'MM'
    
    def test_variation_match_l_and_t(self, mapper):
        result = mapper.map_symbol('L&T')
        
        assert result.is_mapped
        assert result.trading_symbol == 'LT'
    
    def test_no_match_unknown_symbol(self, mapper):
        result = mapper.map_symbol('UNKNOWNXYZ123')
        
        assert not result.is_mapped
        assert result.trading_symbol is None
        assert result.instrument_key is None
        assert result.method == 'none'
    
    def test_empty_symbol(self, mapper):
        result = mapper.map_symbol('')
        
        assert not result.is_mapped
        assert result.method == 'none'
    
    def test_none_symbol(self, mapper):
        result = mapper.map_symbol(None)
        
        assert not result.is_mapped
        assert result.method == 'none'
    
    def test_fuzzy_match(self, mapper):
        result = mapper.map_symbol('RELIANCEE')
        
        assert result.is_mapped
        assert result.trading_symbol == 'RELIANCE'
        assert result.method == 'fuzzy'
        assert result.confidence >= 0.8
    
    def test_fuzzy_match_partial(self, mapper):
        result = mapper.map_symbol('TATAMOTOR')
        
        assert result.is_mapped
        assert result.trading_symbol == 'TATAMOTORS'
        assert result.method == 'fuzzy'
    
    def test_map_symbols_batch(self, mapper):
        symbols = [
            {'code': 'RELIANCE', 'name': 'Reliance', 'url': 'http://example.com/1'},
            {'code': 'TCS', 'name': 'TCS', 'url': 'http://example.com/2'},
            {'code': 'M&M', 'name': 'M&M', 'url': 'http://example.com/3'},
            {'code': 'UNKNOWN', 'name': 'Unknown', 'url': 'http://example.com/4'},
        ]
        
        results = mapper.map_symbols(symbols)
        
        assert len(results) == 4
        
        assert results[0]['trading_symbol'] == 'RELIANCE'
        assert results[0]['match_method'] == 'exact'
        
        assert results[1]['trading_symbol'] == 'TCS'
        assert results[1]['match_method'] in ('exact', 'manual')
        
        assert results[2]['trading_symbol'] == 'MM'
        
        assert results[3]['trading_symbol'] is None
        assert results[3]['match_method'] == 'none'
    
    def test_get_instrument_key(self, mapper):
        key = mapper.get_instrument_key('RELIANCE')
        
        assert key == 'NSE_EQ|INE002A01018'
    
    def test_get_instrument_key_not_found(self, mapper):
        key = mapper.get_instrument_key('UNKNOWN')
        
        assert key is None
    
    def test_normalize_symbol(self, mapper):
        assert mapper._normalize_symbol('reliance') == 'RELIANCE'
        assert mapper._normalize_symbol('RELIANCE.NS') == 'RELIANCE'
        assert mapper._normalize_symbol('RELIANCE-EQ') == 'RELIANCE'
        assert mapper._normalize_symbol('M&M') == 'M&M'
    
    def test_get_stats(self, mapper):
        stats = mapper.get_stats()
        
        assert 'eq_instruments' in stats
        assert 'fuzzy_threshold' in stats
        assert stats['fuzzy_threshold'] == 0.8
        assert stats['eq_instruments'] == 7


class TestGlobalFunctions:
    def test_get_mapper_singleton(self):
        with patch.object(NewsInstrumentMapper, '_try_default_paths'):
            m1 = get_mapper()
            m2 = get_mapper()
            
            assert m1 is m2
    
    def test_map_news_symbol(self):
        with patch.object(NewsInstrumentMapper, '_try_default_paths'):
            with patch.object(NewsInstrumentMapper, '_init_embeddings'):
                mapper = NewsInstrumentMapper(fuzzy_threshold=0.8, use_embeddings=False)
                mapper.instruments = [
                    {
                        'trading_symbol': 'RELIANCE',
                        'instrument_key': 'NSE_EQ|INE002A01018',
                        'name': 'Reliance Industries Ltd',
                        'segment': 'NSE_EQ',
                        'instrument_type': 'EQ'
                    },
                ]
                mapper.symbol_to_instrument = {
                    inst['trading_symbol']: inst for inst in mapper.instruments
                }
                with patch.object(NewsInstrumentMapper, 'map_symbol', wraps=mapper.map_symbol):
                    result = map_news_symbol('RELIANCE')
                    assert result.trading_symbol == 'RELIANCE'
                    assert result.instrument_key == 'NSE_EQ|INE002A01018'

    def test_map_news_symbols(self):
        with patch.object(NewsInstrumentMapper, '_try_default_paths'):
            with patch.object(NewsInstrumentMapper, '_init_embeddings'):
                mapper = NewsInstrumentMapper(fuzzy_threshold=0.8, use_embeddings=False)
                mapper.instruments = [
                    {
                        'trading_symbol': 'RELIANCE',
                        'instrument_key': 'NSE_EQ|INE002A01018',
                        'name': 'Reliance Industries Ltd',
                        'segment': 'NSE_EQ',
                        'instrument_type': 'EQ'
                    },
                ]
                mapper.symbol_to_instrument = {
                    inst['trading_symbol']: inst for inst in mapper.instruments
                }
                with patch.object(NewsInstrumentMapper, 'map_symbols', wraps=mapper.map_symbols):
                    results = map_news_symbols([{'code': 'RELIANCE', 'name': 'Reliance'}])
                    assert len(results) == 1
                    assert results[0]['trading_symbol'] == 'RELIANCE'


class TestEdgeCases:
    def test_special_characters_in_symbol(self, mapper):
        result = mapper.map_symbol('RELIANCE!')
        
        assert result.is_mapped
        assert result.trading_symbol == 'RELIANCE'
    
    def test_numeric_symbol(self, mapper):
        result = mapper.map_symbol('12345')
        
        assert not result.is_mapped
    
    def test_very_long_symbol(self, mapper):
        result = mapper.map_symbol('A' * 100)
        
        assert not result.is_mapped
    
    def test_whitespace_in_symbol(self, mapper):
        result = mapper.map_symbol('  RELIANCE  ')
        
        assert result.is_mapped
        assert result.trading_symbol == 'RELIANCE'
