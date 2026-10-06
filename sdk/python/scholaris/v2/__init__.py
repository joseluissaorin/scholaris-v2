"""Scholaris v2: lector de SPDF 4.0 sin conexión y cliente de la API v2.

    from scholaris.v2 import SPDF, Scholaris
"""
from .api import ErrorApi, Scholaris
from .citas import ancla_a_cita, cita_corta
from .spdf4 import SPDF, ErrorSPDF, Fragmento, Unidad

__all__ = ["SPDF", "ErrorSPDF", "Fragmento", "Unidad", "Scholaris", "ErrorApi", "ancla_a_cita", "cita_corta"]
