import os
import json
import numpy as np
from typing import List, Dict, Any, Tuple

DEFAULT_MODEL_NAME = "all-MiniLM-L6-v2"

class SynopsisEmbedder:
    def __init__(self, model_name: str = DEFAULT_MODEL_NAME):
        self.model_name = model_name
        self.model = None
        self._model_load_attempted = False

    def _load_model(self):
        if self._model_load_attempted:
            return
        self._model_load_attempted = True
        try:
            from sentence_transformers import SentenceTransformer
            print(f"Loading embedding model: {self.model_name}...")
            self.model = SentenceTransformer(self.model_name)
        except Exception as e:
            print(f"[Warning] Could not load SentenceTransformer ({e}). Fallback to TF-IDF vectorizer.")
            self.model = None

    def construct_text(self, title: str, synopsis: str, tags: List[str] = None, genres: List[str] = None) -> str:
        parts = [f"Title: {title}"]
        if genres:
            parts.append(f"Genres: {', '.join(genres)}")
        if tags:
            parts.append(f"Tags: {', '.join(tags[:10])}")
        if synopsis:
            # Clean HTML or excessive whitespace
            clean_syn = synopsis.replace('\n', ' ').strip()
            parts.append(f"Synopsis: {clean_syn[:800]}")
        return " | ".join(parts)

    def encode(self, texts: List[str]) -> np.ndarray:
        self._load_model()
        if self.model is not None:
            return self.model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
        else:
            # Simple TF-IDF fallback vectorizer
            from sklearn.feature_extraction.text import TfidfVectorizer
            vectorizer = TfidfVectorizer(max_features=384, stop_words='english')
            X = vectorizer.fit_transform(texts).toarray()
            # Normalize L2
            norms = np.linalg.norm(X, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            return X / norms

    def cosine_similarity(self, vec_a: np.ndarray, vec_b: np.ndarray) -> float:
        return float(np.dot(vec_a, vec_b))
