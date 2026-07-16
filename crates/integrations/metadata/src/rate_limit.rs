use governor::{
	clock::DefaultClock,
	state::{InMemoryState, NotKeyed},
	Quota, RateLimiter as GovernorLimiter,
};
use std::{num::NonZeroU32, sync::Arc};

/// A simple rate limiter wrapping [`governor::RateLimiter`]
#[derive(Clone)]
pub struct RateLimiter {
	inner: Arc<GovernorLimiter<NotKeyed, InMemoryState, DefaultClock>>,
}

impl RateLimiter {
	/// Creates a new rate limiter with the specified requests per second
	///
	/// # Panics
	/// Panics if `requests_per_second` is 0
	pub fn new(requests_per_second: u32) -> Self {
		let quota = Quota::per_second(
			NonZeroU32::new(requests_per_second)
				.expect("requests_per_second must be > 0"),
		);
		Self {
			inner: Arc::new(GovernorLimiter::direct(quota)),
		}
	}

	/// Creates a new rate limiter with the specified requests per minute
	///
	/// Intended for providers with a low, per-minute burst limit (e.g. Metron's
	/// 20/min). Note: this only enforces the short-window (per-minute) limit; any
	/// longer sustained limit (e.g. Metron's 5,000/day) is left to the server's 429
	/// responses, which `build_client_with_retry`'s retry middleware honors.
	///
	/// # Panics
	/// Panics if `requests_per_minute` is 0
	pub fn per_minute(requests_per_minute: u32) -> Self {
		let quota = Quota::per_minute(
			NonZeroU32::new(requests_per_minute)
				.expect("requests_per_minute must be > 0"),
		);
		Self {
			inner: Arc::new(GovernorLimiter::direct(quota)),
		}
	}

	/// Waits until a request is permitted by the rate limiter
	pub async fn until_ready(&self) {
		self.inner.until_ready().await;
	}

	/// Attempts to acquire permission for a request without waiting
	///
	/// Returns `false` if rate limited
	pub fn try_acquire(&self) -> bool {
		self.inner.check().is_ok()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_rate_limiter_creation() {
		let limiter = RateLimiter::new(10);
		assert!(limiter.try_acquire());
	}

	#[test]
	#[should_panic(expected = "requests_per_second must be > 0")]
	fn test_rate_limiter_zero_rps() {
		let _ = RateLimiter::new(0);
	}

	#[test]
	fn test_rate_limiter_per_minute() {
		let limiter = RateLimiter::per_minute(20);
		assert!(limiter.try_acquire());
	}

	#[test]
	#[should_panic(expected = "requests_per_minute must be > 0")]
	fn test_rate_limiter_per_minute_zero() {
		let _ = RateLimiter::per_minute(0);
	}
}
