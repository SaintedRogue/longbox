use async_graphql::{Context, Object, Result, ID};
use sea_orm::{prelude::*, QueryOrder};

use longbox_core::filesystem::organizer::plan::OrganizePlan;
use models::entity::organize_plan_record;

use crate::data::{AuthContext, CoreContext};
use crate::object::organize::OrganizePreview;

#[derive(Default)]
pub struct OrganizeQuery;

#[Object]
impl OrganizeQuery {
	/// The latest computed organize preview for a library, if any.
	async fn organize_preview(
		&self,
		ctx: &Context<'_>,
		library_id: ID,
	) -> Result<Option<OrganizePreview>> {
		let _auth = ctx.data::<AuthContext>()?;
		let conn = ctx.data::<CoreContext>()?.conn.as_ref();

		let record = organize_plan_record::Entity::find()
			.filter(organize_plan_record::Column::LibraryId.eq(library_id.to_string()))
			.order_by_desc(organize_plan_record::Column::UpdatedAt)
			.one(conn)
			.await?;

		match record {
			Some(record) => {
				let plan: OrganizePlan = serde_json::from_str(&record.plan_json)
					.map_err(|e| format!("Corrupt organize plan record: {e}"))?;
				Ok(Some(plan.into()))
			},
			None => Ok(None),
		}
	}
}
