import { TrueSheet } from '@lodev09/react-native-true-sheet'
import capitalize from 'lodash/capitalize'
import { Pipette } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import tailwindColors from 'tailwindcss/colors'
import { useShallow } from 'zustand/react/shallow'

import { useGridItemSize } from '~/components/listLayout/grid/useGridItemSize'
import { SheetBackDetection } from '~/components/SheetBackDetection'
import { Text } from '~/components/ui'
import { HUES, SETTINGS_COLORS, Shade, useColors } from '~/lib/constants'
import { useTranslate } from '~/lib/hooks'
import { useColorScheme } from '~/lib/useColorScheme'
import { usePreferencesStore } from '~/stores'

import AppSettingsRow from '../AppSettingsRow'

export default function AppPrimaryColor() {
	const { t } = useTranslate()
	const { isDarkColorScheme } = useColorScheme()
	const colors = useColors()

	const { accentHue, patch } = usePreferencesStore(
		useShallow((state) => ({
			accentHue: state.accentHue,
			patch: state.patch,
		})),
	)

	const palette = tailwindColors[accentHue]

	const sheetRef = useRef<TrueSheet>(null)
	const [isOpen, setIsOpen] = useState(false)

	const { itemWidth } = useGridItemSize({
		horizontalGap: 14,
		padding: 28,
	})

	return (
		<>
			<AppSettingsRow
				icon={Pipette}
				iconBackgroundColor={SETTINGS_COLORS.majorVisuals}
				title={t('settings.preferences.appPrimaryColor')}
			>
				<Pressable
					className="w-36 h-8 squircle flex-row rounded-full active:opacity-80"
					onPress={() => sheetRef.current?.present()}
				>
					{ACCENT_SHADES.map((shade) => (
						<View key={shade} className="flex-1" style={{ backgroundColor: palette[shade] }} />
					))}
					<View className="squircle inset-0 border-accent-500/10 absolute rounded-full border" />
				</Pressable>
			</AppSettingsRow>
			<TrueSheet
				ref={sheetRef}
				detents={[0.6]}
				grabber
				scrollable
				backgroundColor={colors.sheet.background}
				grabberOptions={{ color: colors.sheet.grabber }}
				onDidPresent={() => setIsOpen(true)}
				onDidDismiss={() => setIsOpen(false)}
				insetAdjustment="automatic"
			>
				<ScrollView contentContainerClassName="px-4 py-6">
					<View className="gap-4 flex-row flex-wrap justify-center">
						{HUES.map((hue) => {
							const palette = tailwindColors[hue]
							const isSelected = accentHue === hue
							return (
								<Pressable
									key={hue}
									onPress={() => patch({ accentHue: hue })}
									style={{ width: itemWidth }}
									className="p-3 gap-2 rounded-2xl transition-transform active:scale-95"
								>
									<View
										className="inset-0 squircle absolute rounded-3xl"
										style={[
											{ backgroundColor: palette[isDarkColorScheme ? 950 : 50] },
											isSelected && { borderColor: palette[500], borderWidth: 2 },
										]}
									/>
									<Text
										className="font-bold text-center"
										style={{ color: palette[isDarkColorScheme ? 400 : 600] }}
									>
										{/* TODO(accentHue): add labels associated with each hue instead */}
										{capitalize(hue)}
									</Text>

									{/* <LinearGradient
										style={{ height: 21, borderCurve: 'continuous', borderRadius: 7 }}
										colors={[palette[100], palette[300], palette[500], palette[700], palette[900]]}
										useAngle
										angle={90}
									/> */}

									<View className="h-6 squircle flex-row rounded-lg">
										{PREVIEW_SHADES.map((shade) => (
											<View
												key={shade}
												style={{ backgroundColor: palette[shade] }}
												// I noticed there can sometimes be a small (probably sub-pixel) gap, so the scale helps remove it
												className="flex-1 scale-x-105"
											/>
										))}
									</View>
								</Pressable>
							)
						})}
					</View>
				</ScrollView>
			</TrueSheet>
			<SheetBackDetection ref={sheetRef} isOpen={isOpen} />
		</>
	)
}

const ACCENT_SHADES = [100, 300, 500, 700, 900] satisfies Shade[]
const PREVIEW_SHADES = [200, 400, 600, 800] satisfies Shade[]
