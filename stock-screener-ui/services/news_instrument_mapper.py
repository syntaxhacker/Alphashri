"""
News Instrument Mapper Service
==============================

Maps news symbols to Upstox instrument keys with:
- Manual mappings (highest priority) - config/symbol_mappings.json
- Exact matching
- Symbol variations (M&M -> MM, L&T -> LT)
- Fuzzy matching with configurable threshold
- Embedding-based semantic matching for company names
"""

import json
import hashlib
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional, List, Dict, Any, Set
import numpy as np


@dataclass
class MappingResult:
    """Result of mapping a news symbol to an instrument."""
    original_code: str
    trading_symbol: Optional[str]
    instrument_key: Optional[str]
    company_name: Optional[str]
    confidence: float
    method: str
    
    @property
    def is_mapped(self) -> bool:
        return self.instrument_key is not None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'original_code': self.original_code,
            'trading_symbol': self.trading_symbol,
            'instrument_key': self.instrument_key,
            'company_name': self.company_name,
            'confidence': self.confidence,
            'method': self.method
        }


class NewsInstrumentMapper:
    """Maps news source symbols to Upstox instrument keys."""
    
    SYMBOL_VARIATIONS = {
        'M&M': 'MM',
        'M&MFIN': 'MMFIN',
        'L&T': 'LT',
        'L&TFH': 'LTFH',
        'J&KBANK': 'JKBANK',
        'A&B': 'AB',
        'B&A': 'BA',
        'F&O': None,
        'P&G': 'PGHH',
        'PROCTER': 'PGHH',
        '3MINDIA': 'THREEM',
        '3M': 'THREEM',
    }
    
    COMMON_PREFIXES = ['THE ', 'M/S ', 'M/S. ']
    EMBEDDING_MODEL = 'BAAI/bge-small-en-v1.5'
    
    def __init__(
        self, 
        instrument_file: Optional[str] = None, 
        fuzzy_threshold: float = 0.8,
        embedding_threshold: float = 0.75,
        use_embeddings: bool = True,
        manual_mappings_file: Optional[str] = None
    ):
        self.fuzzy_threshold = fuzzy_threshold
        self.embedding_threshold = embedding_threshold
        self.use_embeddings = use_embeddings
        self.instruments: List[Dict] = []
        self.symbol_to_instrument: Dict[str, Dict] = {}
        
        self._embedder = None
        self._company_embeddings: Optional[np.ndarray] = None
        self._company_names: List[str] = []
        self._company_to_symbol: Dict[str, str] = {}
        self._embeddings_loaded: bool = False
        self._embeddings_loading: bool = False
        
        self.manual_mappings: Dict[str, str] = {}
        self.blacklist: Set[str] = set()
        
        if manual_mappings_file:
            self._load_manual_mappings(manual_mappings_file)
        else:
            self._try_load_default_manual_mappings()
        
        if instrument_file:
            self.load_instruments(instrument_file)
        else:
            self._try_default_paths()
    
    def _try_load_default_manual_mappings(self):
        """Try to load manual mappings from default path."""
        config_path = Path(__file__).parent.parent / 'config' / 'symbol_mappings.json'
        if config_path.exists():
            self._load_manual_mappings(str(config_path))
    
    def _load_manual_mappings(self, file_path: str):
        """Load manual mappings from JSON config file."""
        try:
            with open(file_path, 'r') as f:
                config = json.load(f)
            
            self.manual_mappings = config.get('mappings', {})
            self.blacklist = set(config.get('blacklist', []))
            
            print(f"✅ Loaded {len(self.manual_mappings)} manual mappings from {file_path}")
        except Exception as e:
            print(f"⚠️ Could not load manual mappings: {e}")
    
    def _try_default_paths(self):
        """Try to load instruments from default paths."""
        base_path = Path(__file__).parent.parent.parent
        default_paths = [
            base_path / 'upstox_trader' / 'config_and_utils' / 'nse_instruments.json',
            base_path / 'upstox_trader' / 'screeners' / 'nse_instruments.json',
        ]
        
        for path in default_paths:
            if path.exists():
                self.load_instruments(str(path))
                break
    
    def load_instruments(self, file_path: str):
        """Load instruments from JSON file."""
        try:
            with open(file_path, 'r') as f:
                self.instruments = json.load(f)
            
            self.symbol_to_instrument = {}
            
            for inst in self.instruments:
                segment = inst.get('segment', '')
                if segment != 'NSE_EQ':
                    continue
                
                trading_symbol = inst.get('trading_symbol', '').upper()
                name = inst.get('name', '').upper()
                instrument_type = inst.get('instrument_type', '')
                
                if instrument_type != 'EQ':
                    continue
                
                if trading_symbol:
                    self.symbol_to_instrument[trading_symbol] = inst
            
            self._init_embeddings()
                        
        except Exception as e:
            print(f"Error loading instruments: {e}")
    
    def _clean_company_name(self, name: str) -> str:
        """Clean company name for matching."""
        cleaned = name.upper().strip()
        for prefix in self.COMMON_PREFIXES:
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):]
        
        cleaned = ''.join(c for c in cleaned if c.isalnum() or c.isspace())
        return cleaned.strip()
    
    def _init_embeddings(self):
        """Prepare for lazy embedding initialization (non-blocking)."""
        if not self.use_embeddings:
            return
        print(f"⏳ Embeddings will load lazily on first use ({len(self.symbol_to_instrument)} symbols)")
    
    def _ensure_embeddings_loaded(self):
        """Load embeddings lazily on first use. Thread-safe."""
        if not self.use_embeddings:
            return False
        
        if self._embeddings_loaded:
            return True
        
        if self._embeddings_loading:
            return False
        
        self._embeddings_loading = True
        
        try:
            from fastembed import TextEmbedding
        except ImportError:
            print("⚠️ fastembed not installed, embeddings disabled")
            self.use_embeddings = False
            self._embeddings_loading = False
            return False
        
        cache_dir = Path(__file__).parent / '.embedding_cache'
        cache_dir.mkdir(exist_ok=True)
        
        instruments_hash = hashlib.md5(
            json.dumps(sorted(self.symbol_to_instrument.keys())).encode()
        ).hexdigest()[:8]
        
        embeddings_cache = cache_dir / f'embeddings_{instruments_hash}.npy'
        names_cache = cache_dir / f'names_{instruments_hash}.json'
        
        if embeddings_cache.exists() and names_cache.exists():
            try:
                self._company_embeddings = np.load(str(embeddings_cache))
                with open(names_cache, 'r') as f:
                    cache_data = json.load(f)
                self._company_names = cache_data['names']
                self._company_to_symbol = cache_data['mapping']
                self._embedder = TextEmbedding(model_name=self.EMBEDDING_MODEL)
                self._embeddings_loaded = True
                print(f"✅ Loaded cached embeddings for {len(self._company_names)} companies")
                return True
            except Exception as e:
                print(f"⚠️ Failed to load embedding cache: {e}")
        
        print(f"🔄 Computing embeddings for {len(self.symbol_to_instrument)} companies...")
        
        self._embedder = TextEmbedding(model_name=self.EMBEDDING_MODEL)
        
        self._company_names = []
        self._company_to_symbol = {}
        texts_to_embed = []
        
        for symbol, inst in self.symbol_to_instrument.items():
            name = inst.get('name', '')
            if name:
                cleaned = self._clean_company_name(name)
                if cleaned:
                    self._company_names.append(cleaned)
                    self._company_to_symbol[cleaned] = symbol
                    texts_to_embed.append(f"{symbol}: {cleaned}")
        
        if texts_to_embed:
            self._company_embeddings = np.array(list(self._embedder.embed(texts_to_embed)))
            
            np.save(str(embeddings_cache), self._company_embeddings)
            with open(names_cache, 'w') as f:
                json.dump({
                    'names': self._company_names,
                    'mapping': self._company_to_symbol
                }, f)
            
            print(f"✅ Computed and cached embeddings for {len(self._company_names)} companies")
        
        self._embeddings_loaded = True
        return True
    
    def _embedding_match(self, query: str) -> Optional[MappingResult]:
        """Find best match using semantic embeddings."""
        if not self.use_embeddings:
            return None
        
        if not self._embeddings_loaded:
            if not self._ensure_embeddings_loaded():
                return None
        
        if self._company_embeddings is None:
            return None
        
        query_embedding = np.array(list(self._embedder.embed([query])))[0]
        
        similarities = np.dot(self._company_embeddings, query_embedding) / (
            np.linalg.norm(self._company_embeddings, axis=1) * np.linalg.norm(query_embedding) + 1e-8
        )
        
        best_idx = np.argmax(similarities)
        best_score = float(similarities[best_idx])
        
        if best_score >= self.embedding_threshold:
            best_name = self._company_names[best_idx]
            symbol = self._company_to_symbol[best_name]
            inst = self.symbol_to_instrument.get(symbol)
            
            if inst:
                return MappingResult(
                    original_code=query,
                    trading_symbol=inst.get('trading_symbol'),
                    instrument_key=inst.get('instrument_key'),
                    company_name=inst.get('name'),
                    confidence=round(best_score, 2),
                    method='embedding'
                )
        
        return None
    
    def _normalize_symbol(self, code: str) -> str:
        """Normalize symbol code for matching."""
        normalized = code.upper().strip()
        
        normalized = normalized.replace('-', '')
        normalized = normalized.replace('_', '')
        normalized = normalized.replace('.', '')
        normalized = normalized.replace(' ', '')
        
        for suffix in ['EQ', 'NS', 'BO', '-EQ', '.NS', '.BO']:
            if normalized.endswith(suffix):
                normalized = normalized[:-len(suffix)]
        
        return normalized
    
    def map_symbol(self, code: str) -> MappingResult:
        """Map a news symbol to an Upstox instrument.
        
        Priority order:
        1. Manual mappings (config/symbol_mappings.json)
        2. Blacklist check
        3. Exact match
        4. Symbol variations
        5. Fuzzy match
        6. Embedding match
        """
        if not code:
            return MappingResult(
                original_code=code or '',
                trading_symbol=None,
                instrument_key=None,
                company_name=None,
                confidence=0.0,
                method='none'
            )
        
        original_code = code
        normalized = self._normalize_symbol(code)
        
        # 1. Check manual mappings first (highest priority)
        if normalized in self.manual_mappings:
            trading_symbol = self.manual_mappings[normalized]
            if trading_symbol in self.symbol_to_instrument:
                inst = self.symbol_to_instrument[trading_symbol]
                return MappingResult(
                    original_code=original_code,
                    trading_symbol=inst.get('trading_symbol'),
                    instrument_key=inst.get('instrument_key'),
                    company_name=inst.get('name'),
                    confidence=1.0,
                    method='manual'
                )
            # Manual mapping exists but not in instruments file
            return MappingResult(
                original_code=original_code,
                trading_symbol=trading_symbol,
                instrument_key=None,
                company_name=None,
                confidence=0.95,
                method='manual'
            )
        
        # 2. Check blacklist
        if normalized in self.blacklist or code.upper() in self.blacklist:
            return MappingResult(
                original_code=original_code,
                trading_symbol=None,
                instrument_key=None,
                company_name=None,
                confidence=0.0,
                method='blacklisted'
            )
        
        # 3. Exact match
        if normalized in self.symbol_to_instrument:
            inst = self.symbol_to_instrument[normalized]
            return MappingResult(
                original_code=original_code,
                trading_symbol=inst.get('trading_symbol'),
                instrument_key=inst.get('instrument_key'),
                company_name=inst.get('name'),
                confidence=1.0,
                method='exact'
            )
        
        # 4. Symbol variations
        if normalized in self.SYMBOL_VARIATIONS:
            variation = self.SYMBOL_VARIATIONS[normalized]
            if variation is None:
                return MappingResult(
                    original_code=original_code,
                    trading_symbol=None,
                    instrument_key=None,
                    company_name=None,
                    confidence=0.0,
                    method='blacklisted'
                )
            
            if variation in self.symbol_to_instrument:
                inst = self.symbol_to_instrument[variation]
                return MappingResult(
                    original_code=original_code,
                    trading_symbol=inst.get('trading_symbol'),
                    instrument_key=inst.get('instrument_key'),
                    company_name=inst.get('name'),
                    confidence=0.95,
                    method='variation'
                )
        
        # 5. Fuzzy match
        fuzzy_result = self._fuzzy_match(normalized)
        if fuzzy_result:
            return fuzzy_result
        
        # 6. Embedding match
        embedding_result = self._embedding_match(code)
        if embedding_result:
            return embedding_result
        
        return MappingResult(
            original_code=original_code,
            trading_symbol=None,
            instrument_key=None,
            company_name=None,
            confidence=0.0,
            method='none'
        )
    
    def _fuzzy_match(self, normalized: str) -> Optional[MappingResult]:
        """Perform fuzzy matching against known symbols."""
        best_match = None
        best_ratio = 0.0
        
        for symbol, inst in self.symbol_to_instrument.items():
            ratio = SequenceMatcher(None, normalized, symbol).ratio()
            
            if ratio > best_ratio and ratio >= self.fuzzy_threshold:
                best_ratio = ratio
                best_match = inst
        
        if best_match:
            return MappingResult(
                original_code=normalized,
                trading_symbol=best_match.get('trading_symbol'),
                instrument_key=best_match.get('instrument_key'),
                company_name=best_match.get('name'),
                confidence=round(best_ratio, 2),
                method='fuzzy'
            )
        
        return None
    
    def map_symbols(self, symbols: List[Dict]) -> List[Dict[str, Any]]:
        """Map multiple symbols and return enriched data.
        
        Tries mapping in this order:
        1. Symbol code (exact, variation, fuzzy)
        2. Company name via embeddings
        """
        results = []
        
        for sym in symbols:
            code = sym.get('code', '')
            name = sym.get('name', '')
            if not code:
                continue
            
            mapping = self.map_symbol(code)
            
            if not mapping.is_mapped and name and self.use_embeddings:
                name_mapping = self._embedding_match(name)
                if name_mapping and name_mapping.is_mapped:
                    mapping = name_mapping
            
            enriched = {
                'name': sym.get('name', ''),
                'code': code,
                'url': sym.get('url', ''),
                'trading_symbol': mapping.trading_symbol,
                'instrument_key': mapping.instrument_key,
                'company_name': mapping.company_name or sym.get('name', ''),
                'match_confidence': mapping.confidence,
                'match_method': mapping.method
            }
            results.append(enriched)
        
        return results
    
    def get_instrument_key(self, symbol: str) -> Optional[str]:
        """Convenience method to get just the instrument key."""
        mapping = self.map_symbol(symbol)
        return mapping.instrument_key
    
    def get_stats(self) -> Dict[str, Any]:
        """Get mapper statistics."""
        return {
            'total_instruments': len(self.instruments),
            'eq_instruments': len(self.symbol_to_instrument),
            'company_names_indexed': len(self._company_names) if self._company_embeddings is not None else 0,
            'fuzzy_threshold': self.fuzzy_threshold,
            'embedding_threshold': self.embedding_threshold if self.use_embeddings else None,
            'embeddings_enabled': self.use_embeddings,
            'embedding_companies': len(self._company_names) if self._company_embeddings is not None else 0,
            'known_variations': len(self.SYMBOL_VARIATIONS),
            'manual_mappings': len(self.manual_mappings),
            'blacklisted_symbols': len(self.blacklist)
        }


_mapper_instance: Optional[NewsInstrumentMapper] = None


def get_mapper() -> NewsInstrumentMapper:
    """Get singleton mapper instance."""
    global _mapper_instance
    if _mapper_instance is None:
        _mapper_instance = NewsInstrumentMapper()
    return _mapper_instance


def map_news_symbol(code: str) -> MappingResult:
    """Convenience function to map a single symbol."""
    return get_mapper().map_symbol(code)


def map_news_symbols(symbols: List[Dict]) -> List[Dict[str, Any]]:
    """Convenience function to map multiple symbols."""
    return get_mapper().map_symbols(symbols)
