"""Entry point for python -m spdf.migrate"""
from .cli import main
import sys

if __name__ == "__main__":
    sys.exit(main())
