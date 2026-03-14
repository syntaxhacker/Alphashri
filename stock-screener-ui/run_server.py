#!/usr/bin/env python3
"""Wrapper script to run uvicorn with correct PYTHONPATH."""
import sys
import os
from pathlib import Path

# Set up paths BEFORE any imports
_script_dir = Path(__file__).parent.absolute()
_project_root = _script_dir.parent
_scanners_dir = _project_root / 'scanners'

sys.path.insert(0, str(_project_root))
sys.path.insert(0, str(_scanners_dir))
sys.path.insert(0, str(_script_dir))

# Now import and run uvicorn
import uvicorn
import config  # Verify config can be imported

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    host = os.environ.get("HOST", "0.0.0.0")
    
    print(f"Starting server on {host}:{port}")
    print(f"PYTHONPATH includes: {_project_root}, {_script_dir}, {_scanners_dir}")
    
    uvicorn.run(
        "api_server_fastapi:app",
        host=host,
        port=port,
        reload=False
    )
