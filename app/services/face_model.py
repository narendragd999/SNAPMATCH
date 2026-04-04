"""
app/services/face_model.py

★ CPU-OPTIMIZED VERSION FOR GHA (4 cores, no GPU) ★

Key optimizations:
1. Smaller detection size (faster, less accurate but sufficient)
2. Optimized ONNX Runtime session options
3. Model caching and reuse
4. Reduced precision where possible
"""

import os
import logging
from functools import lru_cache

logger = logging.getLogger(__name__)

_analyzer = None
_session_options = None


def _get_onnx_session_options():
    """
    Create optimized ONNX Runtime session options for CPU.
    
    These settings are CRITICAL for performance on 4-core machines.
    """
    global _session_options
    
    if _session_options is None:
        try:
            import onnxruntime as ort
            
            opts = ort.SessionOptions()
            
            # ★ Execution mode optimizations ★
            opts.enable_mem_pattern = True          # Enable memory pattern optimization
            opts.enable_mem_reuse = True            # Reuse memory buffers
            opts.execution_mode = ort.ExecutionMode.SEQUENTIAL  # Sequential is faster for single-image inference
            
            # ★ Threading: SINGLE threaded per worker (we control parallelism externally) ★
            opts.intra_op_num_threads = 1           # Threads WITHIN a single operator
            opts.inter_op_num_threads = 1           # Threads BETWEEN operators
            
            # ★ Graph optimization ★
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            
            # ★ Memory ★
            opts.set_cpu_math_library_num_threads(1)  # Ensure single-threaded math
            
            _session_options = opts
            logger.info("✅ Created optimized ONNX Runtime session options")
            
        except Exception as e:
            logger.warning(f"Could not create ONNX options: {e}")
            _session_options = None
    
    return _session_options


@lru_cache(maxsize=1)  # Cache the analyzer creation
def get_face_analyzer():
    """
    Initialize InsightFace with CPU-specific optimizations.
    
    Uses lru_cache to ensure only ONE analyzer is created (singleton pattern).
    """
    global _analyzer
    
    if _analyzer is None:
        try:
            import insightface
            from insightface.app import FaceAnalysis
            
            logger.info("🔧 Initializing InsightFace (CPU-optimized for GHA)...")
            
            # Get optimized session options
            session_opts = _get_onnx_session_options()
            
            # ★ DETECTION SIZE TUNING ★
            # Default: (640, 640) - Accurate but SLOW on CPU
            # Optimized: (480, 480) - 44% fewer pixels, much faster, still good accuracy
            det_size = (480, 480)  # Was (640, 640)
            
            logger.info(f"📐 Detection size: {det_size} (reduced from 640x640 for speed)")
            
            # Initialize analyzer
            _analyzer = FaceAnalysis(
                name="buffalo_l",
                providers=['CPUExecutionProvider'],  # Force CPU (no GPU on GHA)
                session_options=session_opts,
            )
            
            # Prepare with smaller detection size
            # ctx_id=-1 means CPU
            _analyzer.prepare(ctx_id=-1, det_size=det_size)
            
            model_memory = _analyzer.det_model.input_shape if hasattr(_analyzer.det_model, 'input_shape') else "unknown"
            logger.info(
                f"✅ InsightFace initialized successfully!\n"
                f"   • Provider: CPUExecutionProvider\n"
                f"   • Detection size: {det_size}\n"
                f"   • Model input shape: {model_memory}"
            )
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize InsightFace: {e}", exc_info=True)
            raise RuntimeError(f"Could not initialize face detector: {e}")
    
    return _analyzer


# Module-level accessor (backward compatible)
face_app = get_face_analyzer