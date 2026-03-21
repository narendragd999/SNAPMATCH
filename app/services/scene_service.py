"""
app/services/scene_service.py

Phase 3: Scene Detection using Places365 (lightweight CNN)

Places365 assigns one of 365 scene categories to each image.
Examples: wedding_reception, outdoor_wedding, banquet_hall, concert_hall, ballroom

BUG FIXED: original code used arch="resnet50" but downloaded resnet18 weights.
Loading resnet18 weights into a resnet50 model raises a state_dict mismatch
exception, _scene_model stays None, and scene_label is null for every photo →
scene filter pills never show in the UI.

Fix: use resnet18 consistently (smaller, faster, correct for auto-download).
If PLACES365_MODEL_PATH is set, the arch is inferred from the filename so
a manually supplied resnet50 file still works.

Install:
    pip install torch torchvision
    # Weights download automatically on first use (~50 MB cached to ~/.cache/places365/)

Environment variables:
    PLACES365_MODEL_PATH=/path/to/resnet18_places365.pth.tar  (optional)
"""

import os
import cv2
import numpy as np
from pathlib import Path
from app.services import storage_service

_scene_model     = None
_scene_labels    = None
_scene_transform = None


def _infer_arch(model_path: str) -> str:
    """Infer ResNet architecture from filename. Defaults to resnet18."""
    name = Path(model_path).name.lower()
    if "resnet50" in name:
        return "resnet50"
    if "resnet18" in name:
        return "resnet18"
    return "resnet18"   # safe default — matches the auto-download URL


def load_scene_model():
    """Load Places365 model. Called once at worker startup (idempotent)."""
    global _scene_model, _scene_labels, _scene_transform

    if _scene_model is not None:
        return

    try:
        import torch
        import torchvision.models as models
        from torchvision import transforms

        model_path = os.getenv("PLACES365_MODEL_PATH", "").strip()

        if model_path and os.path.exists(model_path):
            # User supplied a local file — infer arch from filename
            arch = _infer_arch(model_path)
            print(f"📂 Loading Places365 from {model_path}  (arch={arch})")
            checkpoint = torch.load(model_path, map_location="cpu")
        else:
            # Auto-download resnet18 weights (~50 MB, cached after first run)
            arch = "resnet18"
            url  = "http://places2.csail.mit.edu/models_places365/resnet18_places365.pth.tar"
            cache_dir  = Path.home() / ".cache" / "places365"
            cache_dir.mkdir(parents=True, exist_ok=True)
            local_path = cache_dir / "resnet18_places365.pth.tar"

            if not local_path.exists():
                import urllib.request
                print(f"⬇ Downloading Places365 resnet18 weights → {local_path}")
                urllib.request.urlretrieve(url, local_path)
                print("✅ Download complete")

            checkpoint = torch.load(local_path, map_location="cpu")

        # Build model with correct number of output classes (365)
        model = models.__dict__[arch](num_classes=365)

        # Strip DataParallel wrapper if present
        state_dict = checkpoint.get("state_dict", checkpoint)
        state_dict = {k.replace("module.", ""): v for k, v in state_dict.items()}
        model.load_state_dict(state_dict)
        model.eval()

        _scene_model = model

        # Download class labels if not cached
        labels_url   = "https://raw.githubusercontent.com/CSAILVision/places365/master/categories_places365.txt"
        cache_labels = Path.home() / ".cache" / "places365" / "categories_places365.txt"

        if not cache_labels.exists():
            import urllib.request
            urllib.request.urlretrieve(labels_url, cache_labels)

        with open(cache_labels) as f:
            # Each line: "/a/airfield 0" → strip leading "/x/" prefix
            _scene_labels = [line.strip().split(" ")[0][3:] for line in f]

        _scene_transform = transforms.Compose([
            transforms.ToPILImage(),
            transforms.Resize((256, 256)),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225],
            ),
        ])

        print(f"✅ Places365 scene model loaded  (arch={arch})")

    except Exception as e:
        print(f"⚠ Scene model load failed: {e}. Scene detection disabled.")
        _scene_model = None


def detect_scene(event_id: int, image_filename: str) -> dict:
    """
    Detect scene for a single image.

    Returns:
        {
            "scene_label": "wedding_reception",
            "scene_confidence": 0.87,
            "top5": [("wedding_reception", 0.87), ...]
        }
    """
    if _scene_model is None:
        return {"scene_label": None, "scene_confidence": None, "top5": []}

    try:
        import torch

        image_path = storage_service.get_local_temp_path(event_id, image_filename)

        if not os.path.exists(image_path):
            return {"scene_label": None, "scene_confidence": None, "top5": []}

        img = cv2.imread(image_path)
        if img is None:
            return {"scene_label": None, "scene_confidence": None, "top5": []}

        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        tensor  = _scene_transform(img_rgb).unsqueeze(0)

        with torch.no_grad():
            logits = _scene_model(tensor)
            probs  = torch.nn.functional.softmax(logits, dim=1)[0]

        top5_probs, top5_idx = torch.topk(probs, 5)

        top5 = [
            (_scene_labels[idx.item()], round(prob.item(), 4))
            for prob, idx in zip(top5_probs, top5_idx)
        ]

        return {
            "scene_label":      top5[0][0],
            "scene_confidence": top5[0][1],
            "top5":             top5,
        }

    except Exception as e:
        print(f"⚠ Scene detection error for {image_filename}: {e}")
        return {"scene_label": None, "scene_confidence": None, "top5": []}


def batch_detect_scenes(event_id: int, image_filenames: list, batch_size: int = 16) -> dict:
    """Batch scene detection. Returns {filename: scene_result}."""
    if _scene_model is None:
        return {f: {"scene_label": None, "scene_confidence": None} for f in image_filenames}

    return {fn: detect_scene(event_id, fn) for fn in image_filenames}