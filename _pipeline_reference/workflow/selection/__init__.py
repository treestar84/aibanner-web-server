"""
Selection Module
Provides article selection, scoring, and filtering capabilities
"""

from .scorer import calculate_score, apply_penalties
from .diversity import enforce_diversity_quotas
from .dedup import deduplicate_articles

__all__ = [
    'calculate_score',
    'apply_penalties',
    'enforce_diversity_quotas',
    'deduplicate_articles'
]
