"""Allow running the validator as a module: python -m spdf.validator"""

from .cli import main

if __name__ == "__main__":
    import sys
    sys.exit(main())
