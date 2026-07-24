use crate::data::CoreContext;
use async_graphql::{Context, Result, Subscription};
use longbox_core::CoreEvent;
use tokio::sync::broadcast::error::RecvError;

#[derive(Default)]
pub struct EventSubscription;

#[Subscription]
impl EventSubscription {
	async fn read_events(
		&self,
		ctx: &Context<'_>,
	) -> impl futures_util::Stream<Item = Result<CoreEvent>> {
		let mut client_recv = None;
		if let Ok(ctx) = ctx.data::<CoreContext>() {
			client_recv = Some(ctx.get_client_receiver());
		}

		async_stream::stream! {
			let Some(mut rx) = client_recv else {
				tracing::error!("Failed to get client receiver from context!");
				return;
			};

			loop {
				match rx.recv().await {
					Ok(event) => yield Ok(event),
					Err(RecvError::Lagged(missed)) => {
						tracing::warn!(
							missed_events = missed,
							"GraphQL event subscriber lagged; dropping missed events, stream continues"
						);
						continue;
					},
					Err(RecvError::Closed) => {
						tracing::info!("GraphQL event channel closed; ending subscription stream");
						break;
					},
				}
			}
		}
	}
}
