use governor::{
	clock::DefaultClock,
	state::{InMemoryState, NotKeyed},
	Quota, RateLimiter as GovernorLimiter,
};
use std::{num::NonZeroU32, sync::Arc, time::Duration};

type DirectLimiter = GovernorLimiter<NotKeyed, InMemoryState, DefaultClock>;

/// A rate limiter for outbound provider traffic, enforcing up to two independent
/// limits in series.
///
/// Providers constrain clients in two different ways, and collapsing them into one
/// number loses real throughput:
///
/// * a **budget** — the sustained allowance over a long window (ComicVine's 200
///   requests per resource per hour), which is what eventually runs out; and
/// * a **velocity floor** — a minimum spacing between consecutive requests, which is
///   what trips abuse heuristics long before the budget is spent. ComicVine asks that
///   requests come in no faster than one per second per API user, and enforces it with
///   undocumented velocity detection rather than a published quota.
///
/// Modelling only the budget, smeared flat, is what this used to do: ComicVine's
/// 200/hour became `per_minute(3)`, so a match run needing 40 lookups was paced over
/// 13 minutes even with the entire hour's allowance untouched. Modelling only the
/// velocity floor gets the client temporarily blocked. Keeping them separate lets a
/// burst drain the bucket at the velocity floor and then settle onto the sustained
/// refill rate — which is the shape real usage has.
#[derive(Clone)]
pub struct RateLimiter {
	/// The sustained allowance (with burst capacity).
	sustained: Arc<DirectLimiter>,
	/// Optional minimum spacing between consecutive requests.
	velocity: Option<Arc<DirectLimiter>>,
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
		Self::from_quota(quota, None)
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
		Self::from_quota(quota, None)
	}

	/// Creates a limiter for a provider whose real limit is an hourly budget that may
	/// be spent in bursts.
	///
	/// `requests_per_hour` sets the sustained refill rate (one permit every
	/// `3600 / requests_per_hour` seconds). `burst` is how many permits may be held at
	/// once, i.e. how large a burst is allowed after an idle stretch — the bucket
	/// starts full, so a freshly started server may immediately issue `burst`
	/// requests. `min_interval` is the velocity floor applied on top: however many
	/// permits the budget has available, requests never leave faster than one per
	/// `min_interval`.
	///
	/// # Panics
	/// Panics if `requests_per_hour` or `burst` is 0
	pub fn per_hour_with_burst(
		requests_per_hour: u32,
		burst: u32,
		min_interval: Duration,
	) -> Self {
		let quota = Quota::per_hour(
			NonZeroU32::new(requests_per_hour).expect("requests_per_hour must be > 0"),
		)
		.allow_burst(NonZeroU32::new(burst).expect("burst must be > 0"));

		// A zero interval means "no velocity floor"; `Quota::with_period` would reject it.
		let velocity = (!min_interval.is_zero())
			.then(|| Quota::with_period(min_interval))
			.flatten()
			.map(|quota| Arc::new(GovernorLimiter::direct(quota)));

		Self {
			sustained: Arc::new(GovernorLimiter::direct(quota)),
			velocity,
		}
	}

	fn from_quota(quota: Quota, velocity: Option<Quota>) -> Self {
		Self {
			sustained: Arc::new(GovernorLimiter::direct(quota)),
			velocity: velocity.map(|q| Arc::new(GovernorLimiter::direct(q))),
		}
	}

	/// Waits until a request is permitted by every configured limit
	pub async fn until_ready(&self) {
		// Budget first: waiting out the velocity floor only to then discover the hour is
		// spent would hold the permit for the whole budget wait.
		self.sustained.until_ready().await;
		if let Some(velocity) = &self.velocity {
			velocity.until_ready().await;
		}
	}

	/// Attempts to acquire permission for a request without waiting
	///
	/// Returns `false` if rate limited
	pub fn try_acquire(&self) -> bool {
		if let Some(velocity) = &self.velocity {
			if velocity.check().is_err() {
				return false;
			}
		}
		self.inner_check()
	}

	fn inner_check(&self) -> bool {
		self.sustained.check().is_ok()
	}
}

#[cfg(test)]
mod tests {
	use std::time::Instant;

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

	#[test]
	#[should_panic(expected = "requests_per_hour must be > 0")]
	fn test_per_hour_zero() {
		let _ = RateLimiter::per_hour_with_burst(0, 10, Duration::ZERO);
	}

	#[test]
	#[should_panic(expected = "burst must be > 0")]
	fn test_per_hour_zero_burst() {
		let _ = RateLimiter::per_hour_with_burst(200, 0, Duration::ZERO);
	}

	#[test]
	fn burst_capacity_is_available_immediately() {
		// The whole point of the hourly model: an idle client may spend `burst` permits
		// back to back instead of being paced at the smeared sustained rate. The old
		// `per_minute(3)` stand-in for 200/hour allowed 3 before blocking.
		let limiter = RateLimiter::per_hour_with_burst(200, 30, Duration::ZERO);
		for i in 0..30 {
			assert!(
				limiter.try_acquire(),
				"burst permit {i} should be available"
			);
		}
		assert!(
			!limiter.try_acquire(),
			"the 31st request must wait for the sustained refill"
		);
	}

	#[tokio::test]
	async fn velocity_floor_spaces_requests_within_the_burst() {
		// Budget-wise all 3 permits are available at once; the velocity floor is what
		// keeps them from leaving in the same instant and tripping ComicVine's detector.
		let interval = Duration::from_millis(60);
		let limiter = RateLimiter::per_hour_with_burst(3600, 10, interval);

		let start = Instant::now();
		for _ in 0..3 {
			limiter.until_ready().await;
		}
		let elapsed = start.elapsed();

		assert!(
			elapsed >= interval * 2,
			"3 requests at one per {interval:?} must take at least 2 intervals, took {elapsed:?}"
		);
	}

	#[test]
	fn velocity_floor_is_optional() {
		let limiter = RateLimiter::per_hour_with_burst(200, 5, Duration::ZERO);
		assert!(limiter.velocity.is_none());
		assert!(limiter.try_acquire());
	}
}
