import OrganizerActionsSection from './OrganizerActionsSection'
import OrganizerFeaturesPatchForm from './OrganizerFeaturesPatchForm'

export default function OrganizerScene() {
	return (
		<div className="gap-12 flex flex-col">
			<OrganizerActionsSection />
			<OrganizerFeaturesPatchForm />
		</div>
	)
}
