"""Rate limiting utilities for API calls."""
import time
import logging
from typing import List

logger = logging.getLogger(__name__)

# Global rate limit tracking
_perplexity_call_times: List[float] = []
_gemini_call_times: List[float] = []
_deepseek_call_times: List[float] = []


def rate_limit_api(api_name: str, max_calls: int, period_seconds: int) -> None:
    """Generic rate limiter for API calls.

    Args:
        api_name: Name of the API ('perplexity', 'gemini', 'deepseek')
        max_calls: Maximum number of calls allowed in the period
        period_seconds: Time period in seconds

    Raises:
        ValueError: If api_name is not recognized
    """
    global _perplexity_call_times, _gemini_call_times, _deepseek_call_times

    now = time.time()

    # Select the appropriate call times list
    if api_name == "perplexity":
        call_times = _perplexity_call_times
    elif api_name == "gemini":
        call_times = _gemini_call_times
    elif api_name == "deepseek":
        call_times = _deepseek_call_times
    else:
        logger.warning(f"Rate limiting not implemented for API: {api_name}")
        return

    # Remove old timestamps outside the time window
    call_times = [t for t in call_times if now - t < period_seconds]

    # Check if we've hit the rate limit
    if len(call_times) >= max_calls:
        wait_time = period_seconds - (now - call_times[0])
        if wait_time > 0:
            logger.info(f"Rate limit hit for {api_name}. Waiting for {wait_time:.2f} seconds.")
            time.sleep(wait_time)
            # Refresh timestamps after wait
            now = time.time()
            call_times = [t for t in call_times if now - t < period_seconds]

    # Add current timestamp
    call_times.append(now)

    # Update global list
    if api_name == "perplexity":
        _perplexity_call_times = call_times
    elif api_name == "gemini":
        _gemini_call_times = call_times
    elif api_name == "deepseek":
        _deepseek_call_times = call_times


def reset_rate_limits() -> None:
    """Reset all rate limit trackers. Useful for testing."""
    global _perplexity_call_times, _gemini_call_times, _deepseek_call_times
    _perplexity_call_times = []
    _gemini_call_times = []
    _deepseek_call_times = []
