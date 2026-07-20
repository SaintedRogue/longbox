/* eslint-disable */
import * as types from './graphql';



/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n\tquery TagSelectQuery {\n\t\ttags {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": typeof types.TagSelectQueryDocument,
    "\n\tfragment BookCard on Media {\n\t\tid\n\t\tresolvedName\n\t\textension\n\t\tpages\n\t\tsize\n\t\tstatus\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t\theight\n\t\t\twidth\n\t\t}\n\t\treadProgress {\n\t\t\tpercentageCompleted\n\t\t\tepubcfi\n\t\t\tpage\n\t\t\tupdatedAt\n\t\t}\n\t\treadHistory {\n\t\t\t__typename\n\t\t\tcompletedAt\n\t\t}\n\t\tcreatedAt\n\t\tlibraryConfig {\n\t\t\tskipBookOverview\n\t\t}\n\t}\n": typeof types.BookCardFragmentDoc,
    "\n\tquery BookSearchOverlay($pagination: Pagination, $filter: MediaFilterInput!) {\n\t\tmedia(pagination: $pagination, filter: $filter) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...BookCard\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.BookSearchOverlayDocument,
    "\n\tfragment SimpleBookCard on Media {\n\t\tid\n\t\tresolvedName\n\t\tcreatedAt\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t}\n\t}\n": typeof types.SimpleBookCardFragmentDoc,
    "\n\tfragment MediaMetadataEditor on MediaMetadata {\n\t\tageRating\n\t\tcharacters\n\t\tcolorists\n\t\tcoverArtists\n\t\tday\n\t\teditors\n\t\tformat\n\t\tidentifierAmazon\n\t\tidentifierCalibre\n\t\tidentifierGoogle\n\t\tidentifierIsbn\n\t\tidentifierMobiAsin\n\t\tidentifierUuid\n\t\tgenres\n\t\tinkers\n\t\tlanguage\n\t\tletterers\n\t\tlinks\n\t\tmonth\n\t\tnotes\n\t\tnumber\n\t\tpageCount\n\t\tpencillers\n\t\tpublisher\n\t\tseries\n\t\tseriesGroup\n\t\tstoryArc\n\t\tstoryArcNumber\n\t\tsummary\n\t\tteams\n\t\ttitle\n\t\ttitleSort\n\t\tvolume\n\t\twriters\n\t\tyear\n\t\tlockedFields\n\t}\n": typeof types.MediaMetadataEditorFragmentDoc,
    "\n\tmutation UpdateMediaMetadata($id: ID!, $input: MediaMetadataInput!) {\n\t\tupdateMediaMetadata(id: $id, input: $input) {\n\t\t\tmetadata {\n\t\t\t\t...MediaMetadataEditor\n\t\t\t}\n\t\t}\n\t}\n": typeof types.UpdateMediaMetadataDocument,
    "\n\tmutation MediaEditorSetLockedFields($mediaId: ID!, $lockedFields: [MetadataField!]!) {\n\t\tsetMediaLockedFields(mediaId: $mediaId, lockedFields: $lockedFields) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.MediaEditorSetLockedFieldsDocument,
    "\n\tquery BookOverviewScene($id: ID!) {\n\t\tmediaById(id: $id) {\n\t\t\tid\n\t\t\t...BookCard\n\t\t\t...BookFileInformation\n\t\t\tresolvedName\n\t\t\textension\n\t\t\tseriesId\n\t\t\tpages\n\t\t\tsize\n\t\t\tmetadata {\n\t\t\t\tlinks\n\t\t\t\tsummary\n\t\t\t\tageRating\n\t\t\t\tgenres\n\t\t\t\tlanguage\n\t\t\t\tpublisher\n\t\t\t\twriters\n\t\t\t\tyear\n\t\t\t\t...MediaMetadataEditor\n\t\t\t}\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\treadHistory {\n\t\t\t\tcompletedAt\n\t\t\t}\n\t\t}\n\t}\n": typeof types.BookOverviewSceneDocument,
    "\n\tmutation DeleteBookClubConfirmation($id: ID!) {\n\t\tdeleteBookClub(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.DeleteBookClubConfirmationDocument,
    "\n\tfragment BookClubBookItem on BookClubBook {\n\t\tid\n\t\ttitle\n\t\tauthor\n\t\timageUrl\n\t\turl\n\t\tentity {\n\t\t\t__typename\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tmetadata {\n\t\t\t\twriters\n\t\t\t}\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t\tcompletedAt\n\t\taddedAt\n\t}\n": typeof types.BookClubBookItemFragmentDoc,
    "\n\tquery BookClubBooksScene($id: ID!) {\n\t\tbookClubById(id: $id) {\n\t\t\tid\n\t\t\tpreviousBooks {\n\t\t\t\tid\n\t\t\t\t...BookClubBookItem\n\t\t\t}\n\t\t}\n\t}\n": typeof types.BookClubBooksSceneDocument,
    "\n\tquery MediaAtPath($path: String!) {\n\t\tmediaByPath(path: $path) {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": typeof types.MediaAtPathDocument,
    "\n\tmutation UploadLibraryBooks($input: UploadBooksInput!) {\n\t\tuploadBooks(input: $input)\n\t}\n": typeof types.UploadLibraryBooksDocument,
    "\n\tmutation UploadLibrarySeries($input: UploadSeriesInput!) {\n\t\tuploadSeries(input: $input)\n\t}\n": typeof types.UploadLibrarySeriesDocument,
    "\n\tquery MediaFilterForm($seriesId: ID) {\n\t\tmediaMetadataOverview(seriesId: $seriesId) {\n\t\t\tgenres\n\t\t\twriters\n\t\t\tpencillers\n\t\t\tcolorists\n\t\t\tletterers\n\t\t\tinkers\n\t\t\tpublishers\n\t\t\teditors\n\t\t\tcharacters\n\t\t}\n\t}\n": typeof types.MediaFilterFormDocument,
    "\n\tmutation DeleteLibrary($id: ID!) {\n\t\tdeleteLibrary(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.DeleteLibraryDocument,
    "\n\tquery LastVisitedLibrary {\n\t\tlastVisitedLibrary {\n\t\t\tid\n\t\t\tname\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": typeof types.LastVisitedLibraryDocument,
    "\n\tquery LibraryBooksAlphabet($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tmediaAlphabet\n\t\t}\n\t}\n": typeof types.LibraryBooksAlphabetDocument,
    "\n\tquery LibrarySeriesAlphabet($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tseriesAlphabet\n\t\t}\n\t}\n": typeof types.LibrarySeriesAlphabetDocument,
    "\n\tfragment PendingMatchRecord on MetadataFetchRecord {\n\t\tid\n\t\tstatus\n\t\tmediaId\n\t\tseriesId\n\t\tmatchCandidates {\n\t\t\tprovider\n\t\t\texternalId\n\t\t\tmetadata {\n\t\t\t\t__typename\n\t\t\t\t... on ExternalMediaMetadata {\n\t\t\t\t\ttitle\n\t\t\t\t\tseriesName\n\t\t\t\t\tseriesExternalId\n\t\t\t\t\tsummary\n\t\t\t\t\tpageCount\n\t\t\t\t\tnumber\n\t\t\t\t\tday\n\t\t\t\t\tmonth\n\t\t\t\t\tyear\n\t\t\t\t\tgenres\n\t\t\t\t\ttags\n\t\t\t\t\tisbn\n\t\t\t\t\tisbn13\n\t\t\t\t\twriters\n\t\t\t\t\tartists\n\t\t\t\t\tcolorists\n\t\t\t\t\tletterers\n\t\t\t\t\tcoverArtists\n\t\t\t\t}\n\t\t\t\t... on ExternalSeriesMetadata {\n\t\t\t\t\tseriesTitle: title\n\t\t\t\t\talternativeTitles\n\t\t\t\t\tsummary\n\t\t\t\t\tvolumeCount\n\t\t\t\t\tcoverUrl\n\t\t\t\t\tstatus\n\t\t\t\t\tyear\n\t\t\t\t\tendYear\n\t\t\t\t\tgenres\n\t\t\t\t\ttags\n\t\t\t\t\tauthors\n\t\t\t\t\tageRating\n\t\t\t\t\tpublisher\n\t\t\t\t}\n\t\t\t}\n\t\t\tconfidence\n\t\t\tconfidenceFactors {\n\t\t\t\tfactor\n\t\t\t\tweight\n\t\t\t\tmatched\n\t\t\t}\n\t\t}\n\t\taddedAt\n\t\tupdatedAt\n\t\tmedia {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tmetadata {\n\t\t\t\ttitle\n\t\t\t\tsummary\n\t\t\t\tgenres\n\t\t\t\twriters\n\t\t\t\tcolorists\n\t\t\t\tletterers\n\t\t\t\tcoverArtists\n\t\t\t\tpublisher\n\t\t\t\tyear\n\t\t\t\tmonth\n\t\t\t\tday\n\t\t\t\tpageCount\n\t\t\t\tidentifierIsbn\n\t\t\t\tlockedFields\n\t\t\t}\n\t\t}\n\t\tseries {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tmetadata {\n\t\t\t\ttitle\n\t\t\t\tsummary\n\t\t\t\tgenres\n\t\t\t\twriters\n\t\t\t\tpublisher\n\t\t\t\tyear\n\t\t\t\tstatus\n\t\t\t\tageRating\n\t\t\t\tvolume\n\t\t\t\tlockedFields\n\t\t\t}\n\t\t}\n\t}\n": typeof types.PendingMatchRecordFragmentDoc,
    "\n\tquery PendingMetadataMatches {\n\t\tpendingMetadataMatches {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n": typeof types.PendingMetadataMatchesDocument,
    "\n\tmutation AcceptAllPendingMatches($strategy: MergeStrategy, $excludeFields: [MetadataField!]) {\n\t\tacceptAllPendingMatches(strategy: $strategy, excludeFields: $excludeFields)\n\t}\n": typeof types.AcceptAllPendingMatchesDocument,
    "\n\tmutation RejectAllPendingMatches {\n\t\trejectAllPendingMatches\n\t}\n": typeof types.RejectAllPendingMatchesDocument,
    "\n\tmutation AcceptMediaMatch(\n\t\t$mediaId: ID!\n\t\t$candidateIndex: Int!\n\t\t$strategy: MergeStrategy\n\t\t$excludeFields: [MetadataField!]\n\t\t$overrides: [MetadataFieldOverride!]\n\t) {\n\t\tacceptMediaMatch(\n\t\t\tmediaId: $mediaId\n\t\t\tcandidateIndex: $candidateIndex\n\t\t\tstrategy: $strategy\n\t\t\texcludeFields: $excludeFields\n\t\t\toverrides: $overrides\n\t\t) {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n": typeof types.AcceptMediaMatchDocument,
    "\n\tmutation AcceptSeriesMatch(\n\t\t$seriesId: ID!\n\t\t$candidateIndex: Int!\n\t\t$strategy: MergeStrategy\n\t\t$excludeFields: [MetadataField!]\n\t\t$overrides: [MetadataFieldOverride!]\n\t) {\n\t\tacceptSeriesMatch(\n\t\t\tseriesId: $seriesId\n\t\t\tcandidateIndex: $candidateIndex\n\t\t\tstrategy: $strategy\n\t\t\texcludeFields: $excludeFields\n\t\t\toverrides: $overrides\n\t\t) {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n": typeof types.AcceptSeriesMatchDocument,
    "\n\tmutation RejectMediaMatch($mediaId: ID!, $candidateIndex: Int!) {\n\t\trejectMediaMatch(mediaId: $mediaId, candidateIndex: $candidateIndex) {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n": typeof types.RejectMediaMatchDocument,
    "\n\tmutation RejectSeriesMatch($seriesId: ID!, $candidateIndex: Int!) {\n\t\trejectSeriesMatch(seriesId: $seriesId, candidateIndex: $candidateIndex) {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n": typeof types.RejectSeriesMatchDocument,
    "\n\tmutation SetMediaLockedFields($mediaId: ID!, $lockedFields: [MetadataField!]!) {\n\t\tsetMediaLockedFields(mediaId: $mediaId, lockedFields: $lockedFields) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.SetMediaLockedFieldsDocument,
    "\n\tmutation SetSeriesLockedFields($seriesId: ID!, $lockedFields: [MetadataField!]!) {\n\t\tsetSeriesLockedFields(seriesId: $seriesId, lockedFields: $lockedFields) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.SetSeriesLockedFieldsDocument,
    "\n\tquery ProviderMatchMediaContext($id: ID!) {\n\t\tmediaById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t\tresolvedName\n\t\t}\n\t}\n": typeof types.ProviderMatchMediaContextDocument,
    "\n\tquery ProviderMatchSeriesContext($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t\tresolvedName\n\t\t}\n\t}\n": typeof types.ProviderMatchSeriesContextDocument,
    "\n\tquery ProviderMatchParse($name: String!) {\n\t\tparseComicFilename(name: $name) {\n\t\t\tseries\n\t\t\tnumber\n\t\t\tyear\n\t\t}\n\t}\n": typeof types.ProviderMatchParseDocument,
    "\n\tquery ProviderMatchProviders {\n\t\tmetadataProviderConfigs {\n\t\t\tid\n\t\t\tproviderType\n\t\t\tenabled\n\t\t\tposition\n\t\t}\n\t}\n": typeof types.ProviderMatchProvidersDocument,
    "\n\tmutation ProviderMatchFindMedia(\n\t\t$id: ID!\n\t\t$query: MetadataSearchInput\n\t\t$provider: MetadataProvider\n\t) {\n\t\tfetchMediaMetadata(id: $id, query: $query, provider: $provider, autoApply: false) {\n\t\t\tprovider\n\t\t\texternalId\n\t\t\tconfidence\n\t\t\tmetadata {\n\t\t\t\t__typename\n\t\t\t\t... on ExternalMediaMetadata {\n\t\t\t\t\ttitle\n\t\t\t\t\tseriesName\n\t\t\t\t\tnumberRaw\n\t\t\t\t\tyear\n\t\t\t\t\tpublisher\n\t\t\t\t\twriters\n\t\t\t\t\tcoverUrl\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.ProviderMatchFindMediaDocument,
    "\n\tmutation ProviderMatchFindSeries(\n\t\t$id: ID!\n\t\t$query: MetadataSearchInput\n\t\t$provider: MetadataProvider\n\t) {\n\t\tfetchSeriesMetadata(id: $id, query: $query, provider: $provider, autoApply: false) {\n\t\t\tprovider\n\t\t\texternalId\n\t\t\tconfidence\n\t\t\tmetadata {\n\t\t\t\t__typename\n\t\t\t\t... on ExternalSeriesMetadata {\n\t\t\t\t\ttitle\n\t\t\t\t\tyear\n\t\t\t\t\tpublisher\n\t\t\t\t\tauthors\n\t\t\t\t\tcoverUrl\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.ProviderMatchFindSeriesDocument,
    "\n\tmutation ProviderMatchAcceptMedia($mediaId: ID!, $candidateIndex: Int!) {\n\t\tacceptMediaMatch(mediaId: $mediaId, candidateIndex: $candidateIndex) {\n\t\t\tid\n\t\t\tstatus\n\t\t}\n\t}\n": typeof types.ProviderMatchAcceptMediaDocument,
    "\n\tmutation ProviderMatchAcceptSeries($seriesId: ID!, $candidateIndex: Int!) {\n\t\tacceptSeriesMatch(seriesId: $seriesId, candidateIndex: $candidateIndex) {\n\t\t\tid\n\t\t\tstatus\n\t\t}\n\t}\n": typeof types.ProviderMatchAcceptSeriesDocument,
    "\n\tquery SideBarQuery {\n\t\tme {\n\t\t\tid\n\t\t\tpreferences {\n\t\t\t\tnavigationArrangement {\n\t\t\t\t\tlocked\n\t\t\t\t\tsections {\n\t\t\t\t\t\tconfig {\n\t\t\t\t\t\t\t__typename\n\t\t\t\t\t\t\t... on SystemArrangementConfig {\n\t\t\t\t\t\t\t\tvariant\n\t\t\t\t\t\t\t\tlinks\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}\n\t\t\t\t\t\tvisible\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.SideBarQueryDocument,
    "\n\tquery BookClubSideBarSection {\n\t\tbookClubs {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t\temoji\n\t\t\tmembers {\n\t\t\t\tid\n\t\t\t\tuserId\n\t\t\t\trole\n\t\t\t}\n\t\t}\n\t}\n": typeof types.BookClubSideBarSectionDocument,
    "\n\tmutation UpdateLibraryEmoji($id: ID!, $emoji: String) {\n\t\tupdateLibraryEmoji(id: $id, emoji: $emoji) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.UpdateLibraryEmojiDocument,
    "\n\tmutation ScanLibraryMutation($id: ID!) {\n\t\tscanLibrary(id: $id)\n\t}\n": typeof types.ScanLibraryMutationDocument,
    "\n\tquery LibrarySideBarSection {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\temoji\n\t\t\t}\n\t\t}\n\t}\n": typeof types.LibrarySideBarSectionDocument,
    "\n\tquery SmartListSideBarSection {\n\t\tsmartLists {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": typeof types.SmartListSideBarSectionDocument,
    "\n\tquery TopNavigation {\n\t\tme {\n\t\t\tid\n\t\t\tpreferences {\n\t\t\t\tnavigationArrangement {\n\t\t\t\t\tlocked\n\t\t\t\t\tsections {\n\t\t\t\t\t\tconfig {\n\t\t\t\t\t\t\t__typename\n\t\t\t\t\t\t\t... on SystemArrangementConfig {\n\t\t\t\t\t\t\t\tvariant\n\t\t\t\t\t\t\t\tlinks\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}\n\t\t\t\t\t\tvisible\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.TopNavigationDocument,
    "\n\tquery BookClubNavigationItem {\n\t\tbookClubs {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t\temoji\n\t\t}\n\t}\n": typeof types.BookClubNavigationItemDocument,
    "\n\tquery LibraryNavigationItem {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\temoji\n\t\t\t}\n\t\t}\n\t}\n": typeof types.LibraryNavigationItemDocument,
    "\n\tquery SmartListNavigationItem {\n\t\tsmartLists {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": typeof types.SmartListNavigationItemDocument,
    "\n\tquery EpubJsReader($id: ID!) {\n\t\tepubById(id: $id) {\n\t\t\tmediaId\n\t\t\trootBase\n\t\t\trootFile\n\t\t\textraCss\n\t\t\ttoc\n\t\t\tresources\n\t\t\tmetadata\n\t\t\tspine {\n\t\t\t\tid\n\t\t\t\tidref\n\t\t\t\tproperties\n\t\t\t\tlinear\n\t\t\t}\n\t\t\tbookmarks {\n\t\t\t\tid\n\t\t\t\tuserId\n\t\t\t\tepubcfi\n\t\t\t\tmediaId\n\t\t\t\tcreatedAt\n\t\t\t}\n\t\t\tmedia {\n\t\t\t\tid\n\t\t\t\tresolvedName\n\t\t\t\tpages\n\t\t\t\textension\n\t\t\t\treadProgress {\n\t\t\t\t\tpercentageCompleted\n\t\t\t\t\tepubcfi\n\t\t\t\t\tpage\n\t\t\t\t\telapsedSeconds\n\t\t\t\t}\n\t\t\t\tlibraryConfig {\n\t\t\t\t\tdefaultReadingImageScaleFit\n\t\t\t\t\tdefaultReadingMode\n\t\t\t\t\tdefaultReadingDir\n\t\t\t\t}\n\t\t\t\tnextInSeries(pagination: { cursor: { limit: 1 } }) {\n\t\t\t\t\tnodes {\n\t\t\t\t\t\tid\n\t\t\t\t\t\tname: resolvedName\n\t\t\t\t\t\tthumbnail {\n\t\t\t\t\t\t\turl\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.EpubJsReaderDocument,
    "\n\tmutation CreateBookmark($input: BookmarkInput!) {\n\t\tcreateBookmark(input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n": typeof types.CreateBookmarkDocument,
    "\n\tmutation DeleteBookmarkByEpubcfi($epubcfi: String!) {\n\t\tdeleteBookmarkByEpubcfi(epubcfi: $epubcfi) {\n\t\t\t__typename\n\t\t}\n\t}\n": typeof types.DeleteBookmarkByEpubcfiDocument,
    "\n\tquery SeriesBooksAlphabet($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tmediaAlphabet\n\t\t}\n\t}\n": typeof types.SeriesBooksAlphabetDocument,
    "\n\tfragment SeriesMetadataEditor on SeriesMetadata {\n\t\tageRating\n\t\tbooktype\n\t\tcharacters\n\t\tcollects {\n\t\t\tseries\n\t\t\tcomicid\n\t\t\tissueid\n\t\t\tissues\n\t\t}\n\t\tcomicImage\n\t\tcomicid\n\t\tdescriptionFormatted\n\t\tgenres\n\t\timprint\n\t\tlinks\n\t\tmetaType\n\t\tpublicationRun\n\t\tpublisher\n\t\tstatus\n\t\tsummary\n\t\ttitle\n\t\ttotalIssues\n\t\tvolume\n\t\twriters\n\t\tyear\n\t\tlockedFields\n\t}\n": typeof types.SeriesMetadataEditorFragmentDoc,
    "\n\tmutation UpdateSeriesMetadata($id: ID!, $input: SeriesMetadataInput!) {\n\t\tupdateSeriesMetadata(id: $id, input: $input) {\n\t\t\tmetadata {\n\t\t\t\t...SeriesMetadataEditor\n\t\t\t}\n\t\t}\n\t}\n": typeof types.UpdateSeriesMetadataDocument,
    "\n\tmutation SeriesEditorSetLockedFields($seriesId: ID!, $lockedFields: [MetadataField!]!) {\n\t\tsetSeriesLockedFields(seriesId: $seriesId, lockedFields: $lockedFields) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.SeriesEditorSetLockedFieldsDocument,
    "\n\tsubscription UseCoreEvent {\n\t\treadEvents {\n\t\t\t__typename\n\t\t\t... on CreatedManySeries {\n\t\t\t\tcount\n\t\t\t\tlibraryId\n\t\t\t}\n\t\t\t... on CreatedMedia {\n\t\t\t\tid\n\t\t\t\tseriesId\n\t\t\t}\n\t\t\t... on CreatedOrUpdatedManyMedia {\n\t\t\t\tcount\n\t\t\t\tseriesId\n\t\t\t}\n\t\t\t... on DiscoveredMissingLibrary {\n\t\t\t\tid\n\t\t\t}\n\t\t\t... on JobStarted {\n\t\t\t\tid\n\t\t\t}\n\t\t\t... on JobUpdate {\n\t\t\t\t__typename\n\t\t\t\tid\n\t\t\t\tstatus\n\t\t\t\tmessage\n\t\t\t\tcompletedTasks\n\t\t\t\tremainingTasks\n\t\t\t\tcompletedSubtasks\n\t\t\t\ttotalSubtasks\n\t\t\t\tsubtitle\n\t\t\t}\n\t\t\t... on JobOutput {\n\t\t\t\tid\n\t\t\t\toutput {\n\t\t\t\t\t__typename\n\t\t\t\t\t... on LibraryScanOutput {\n\t\t\t\t\t\tcreatedMedia\n\t\t\t\t\t\tcreatedSeries\n\t\t\t\t\t\tupdatedMedia\n\t\t\t\t\t\tupdatedSeries\n\t\t\t\t\t}\n\t\t\t\t\t... on SeriesScanOutput {\n\t\t\t\t\t\tcreatedMedia\n\t\t\t\t\t\tupdatedMedia\n\t\t\t\t\t}\n\t\t\t\t\t... on OrganizeLooseFilesOutput {\n\t\t\t\t\t\tmoved\n\t\t\t\t\t\tproposedMoves\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.UseCoreEventDocument,
    "\n\tmutation UsePreferences($input: UpdateUserPreferencesInput!) {\n\t\tupdateViewerPreferences(input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n": typeof types.UsePreferencesDocument,
    "\n\tmutation UpdateReadProgress($id: ID!, $input: MediaProgressInput!) {\n\t\tupdateMediaProgress(id: $id, input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n": typeof types.UpdateReadProgressDocument,
    "\n\tmutation BookActionMenuComplete($id: ID!) {\n\t\tfinishMediaProgress(id: $id)\n\t}\n": typeof types.BookActionMenuCompleteDocument,
    "\n\tmutation BookActionMenuDeleteSession($id: ID!) {\n\t\tclearMediaProgress(id: $id)\n\t}\n": typeof types.BookActionMenuDeleteSessionDocument,
    "\n\tmutation BookActionMenuDeleteHistory($id: ID!) {\n\t\tdeleteMediaReadingHistory(id: $id)\n\t}\n": typeof types.BookActionMenuDeleteHistoryDocument,
    "\n\tfragment BookFileInformation on Media {\n\t\tid\n\t\tsize\n\t\textension\n\t\thash\n\t\trelativeLibraryPath\n\t}\n": typeof types.BookFileInformationFragmentDoc,
    "\n\tquery BookLibrarySeriesLinks($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tlibrary {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t}\n\t}\n": typeof types.BookLibrarySeriesLinksDocument,
    "\n\tfragment BookMetadata on Media {\n\t\tmetadata {\n\t\t\tageRating\n\t\t\tcharacters\n\t\t\tcolorists\n\t\t\tcoverArtists\n\t\t\teditors\n\t\t\tgenres\n\t\t\tinkers\n\t\t\tletterers\n\t\t\tlinks\n\t\t\tpencillers\n\t\t\tpublisher\n\t\t\tteams\n\t\t\twriters\n\t\t\tyear\n\t\t\tmonth\n\t\t\tday\n\t\t\tvolume\n\t\t\tnumber\n\t\t}\n\t}\n": typeof types.BookMetadataFragmentDoc,
    "\n\tquery BooksAfterCurrentQuery($id: ID!, $pagination: Pagination) {\n\t\tmediaById(id: $id) {\n\t\t\tnextInSeries(pagination: $pagination) {\n\t\t\t\tnodes {\n\t\t\t\t\tid\n\t\t\t\t\t...BookCard\n\t\t\t\t}\n\t\t\t\tpageInfo {\n\t\t\t\t\t__typename\n\t\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\t\tcurrentCursor\n\t\t\t\t\t\tnextCursor\n\t\t\t\t\t\tlimit\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.BooksAfterCurrentQueryDocument,
    "\n\tquery BooksAlphabet {\n\t\tmediaAlphabet\n\t}\n": typeof types.BooksAlphabetDocument,
    "\n\tquery EmailBookDropdownDevice {\n\t\temailDevices {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": typeof types.EmailBookDropdownDeviceDocument,
    "\n\tmutation SendEmailAttachment($id: ID!, $sendTo: [EmailerSendTo!]!) {\n\t\tsendAttachmentEmail(input: { mediaIds: [$id], sendTo: $sendTo }) {\n\t\t\tsentCount\n\t\t\terrors\n\t\t}\n\t}\n": typeof types.SendEmailAttachmentDocument,
    "\n\tquery BookReaderScene($id: ID!) {\n\t\tmediaById(id: $id) {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tpages\n\t\t\textension\n\t\t\treadProgress {\n\t\t\t\tpercentageCompleted\n\t\t\t\tepubcfi\n\t\t\t\tpage\n\t\t\t\telapsedSeconds\n\t\t\t}\n\t\t\tlibraryConfig {\n\t\t\t\tdefaultReadingImageScaleFit\n\t\t\t\tdefaultReadingMode\n\t\t\t\tdefaultReadingDir\n\t\t\t}\n\t\t\tanalysisData {\n\t\t\t\tdimensions {\n\t\t\t\t\theight\n\t\t\t\t\twidth\n\t\t\t\t}\n\t\t\t}\n\t\t\tnextInSeries(pagination: { cursor: { limit: 1 } }) {\n\t\t\t\tnodes {\n\t\t\t\t\tid\n\t\t\t\t\tname: resolvedName\n\t\t\t\t\tthumbnail {\n\t\t\t\t\t\turl\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.BookReaderSceneDocument,
    "\n\tquery BookManagementScene($id: ID!) {\n\t\tmediaById(id: $id) {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tlibrary {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tseries {\n\t\t\t\tid\n\t\t\t\tresolvedName\n\t\t\t}\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\t...BookThumbnailSelector\n\t\t}\n\t}\n": typeof types.BookManagementSceneDocument,
    "\n\tmutation BookManagementSceneAnalyze($id: ID!) {\n\t\tanalyzeMedia(id: $id)\n\t}\n": typeof types.BookManagementSceneAnalyzeDocument,
    "\n\tmutation BookTagEditorSetTags($id: ID!, $tags: [String!]!) {\n\t\tsetMediaTags(id: $id, tags: $tags) {\n\t\t\tid\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t}\n\t}\n": typeof types.BookTagEditorSetTagsDocument,
    "\n\tfragment BookThumbnailSelector on Media {\n\t\tid\n\t\tthumbnail {\n\t\t\turl\n\t\t}\n\t\tpages\n\t}\n": typeof types.BookThumbnailSelectorFragmentDoc,
    "\n\tmutation BookThumbnailSelectorUpdate($id: ID!, $input: PageBasedThumbnailInput!) {\n\t\tupdateMediaThumbnail(id: $id, input: $input) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": typeof types.BookThumbnailSelectorUpdateDocument,
    "\n\tmutation BookThumbnailSelectorUpload($id: ID!, $file: Upload!) {\n\t\tuploadMediaThumbnail(id: $id, file: $file) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": typeof types.BookThumbnailSelectorUploadDocument,
    "\n\tquery BookClubLayout($slug: String!) {\n\t\tbookClubBySlug(slug: $slug) {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t\tdescription\n\t\t\tisPrivate\n\t\t\troleSpec\n\t\t\tcreator {\n\t\t\t\tid\n\t\t\t\tdisplayName\n\t\t\t\tavatarUrl\n\t\t\t}\n\t\t\tmembersCount\n\t\t\tmembership {\n\t\t\t\trole\n\t\t\t\tavatarUrl\n\t\t\t\tisCreator\n\t\t\t}\n\t\t\tcurrentBook {\n\t\t\t\tid\n\t\t\t\ttitle\n\t\t\t\tauthor\n\t\t\t\timageUrl\n\t\t\t\tentity {\n\t\t\t\t\tid\n\t\t\t\t\tthumbnail {\n\t\t\t\t\t\turl\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\t...BookClubBookItem\n\t\t\t}\n\t\t\tcreatedAt\n\t\t}\n\t}\n": typeof types.BookClubLayoutDocument,
    "\n\tmutation UpdateBookClub($id: ID!, $input: UpdateBookClubInput!) {\n\t\tupdateBookClub(id: $id, input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t\temoji\n\t\t\tisPrivate\n\t\t\troleSpec\n\t\t\tdescription\n\t\t}\n\t}\n": typeof types.UpdateBookClubDocument,
    "\n\tquery UserBookClubsScene {\n\t\tbookClubs(all: false) {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t\tdescription\n\t\t\tmembersCount\n\t\t\tcurrentBook {\n\t\t\t\tid\n\t\t\t}\n\t\t}\n\t}\n": typeof types.UserBookClubsSceneDocument,
    "\n\tquery CreateBookClubForm {\n\t\tbookClubs {\n\t\t\tname\n\t\t\tslug\n\t\t}\n\t}\n": typeof types.CreateBookClubFormDocument,
    "\n\tmutation CreateBookClubScene($input: CreateBookClubInput!) {\n\t\tcreateBookClub(input: $input) {\n\t\t\tid\n\t\t\tslug\n\t\t}\n\t}\n": typeof types.CreateBookClubSceneDocument,
    "\n\tquery BookClubBasicSettingsScene {\n\t\tbookClubs(all: true) {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t}\n\t}\n": typeof types.BookClubBasicSettingsSceneDocument,
    "\n\tquery BookClubMembersTable($id: ID!) {\n\t\tbookClubById(id: $id) {\n\t\t\tid\n\t\t\tmembers {\n\t\t\t\tid\n\t\t\t\tavatarUrl\n\t\t\t\tisCreator\n\t\t\t\tdisplayName\n\t\t\t\trole\n\t\t\t\tuserId\n\t\t\t}\n\t\t}\n\t}\n": typeof types.BookClubMembersTableDocument,
    "\n\tmutation RemoveBookClubMember($bookClubId: ID!, $memberId: ID!) {\n\t\tremoveBookClubMember(bookClubId: $bookClubId, memberId: $memberId) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.RemoveBookClubMemberDocument,
    "\n\tquery BookSearchScene(\n\t\t$filter: MediaFilterInput!\n\t\t$orderBy: [MediaOrderBy!]!\n\t\t$pagination: Pagination!\n\t) {\n\t\tmedia(filter: $filter, orderBy: $orderBy, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...BookCard\n\t\t\t\t...BookMetadata\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.BookSearchSceneDocument,
    "\n\tquery CreateLibrarySceneExistingLibraries {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\tpath\n\t\t\t}\n\t\t}\n\t}\n": typeof types.CreateLibrarySceneExistingLibrariesDocument,
    "\n\tmutation CreateLibrarySceneCreateLibrary($input: CreateOrUpdateLibraryInput!) {\n\t\tcreateLibrary(input: $input) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.CreateLibrarySceneCreateLibraryDocument,
    "\n\tquery CreateSmartListForm {\n\t\tsmartLists(input: { mine: true }) {\n\t\t\tname\n\t\t}\n\t}\n": typeof types.CreateSmartListFormDocument,
    "\n\tmutation CreateSmartListScene($input: SaveSmartListInput!) {\n\t\tcreateSmartList(input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": typeof types.CreateSmartListSceneDocument,
    "\n\tfragment ContinueReadingBook on Media {\n\t\tid\n\t\tresolvedName\n\t\tpages\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t}\n\t\treadProgress {\n\t\t\tpercentageCompleted\n\t\t\tepubcfi\n\t\t\tpage\n\t\t\tupdatedAt\n\t\t}\n\t}\n": typeof types.ContinueReadingBookFragmentDoc,
    "\n\tquery ContinueReadingMedia($pagination: Pagination!) {\n\t\tkeepReading(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...ContinueReadingBook\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.ContinueReadingMediaDocument,
    "\n\tquery HomeSceneQuery {\n\t\tnumberOfLibraries\n\t}\n": typeof types.HomeSceneQueryDocument,
    "\n\tfragment OnDeckBook on Media {\n\t\tid\n\t\tmetadata {\n\t\t\tnumber\n\t\t}\n\t\tresolvedName\n\t\tseriesPosition\n\t\tseries {\n\t\t\tmediaCount\n\t\t\tmetadata {\n\t\t\t\ttotalIssues\n\t\t\t}\n\t\t}\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t}\n\t}\n": typeof types.OnDeckBookFragmentDoc,
    "\n\tquery OnDeckBooksWeb($pagination: Pagination!) {\n\t\tonDeck(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...OnDeckBook\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.OnDeckBooksWebDocument,
    "\n\tfragment RecentlyAddedBook on Media {\n\t\tid\n\t\tresolvedName\n\t\tcreatedAt\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t}\n\t}\n": typeof types.RecentlyAddedBookFragmentDoc,
    "\n\tquery RecentlyAddedMedia($pagination: Pagination!) {\n\t\trecentlyAddedMedia(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...RecentlyAddedBook\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.RecentlyAddedMediaDocument,
    "\n\tquery RecentlyAddedSeries($pagination: Pagination!) {\n\t\trecentlyAddedSeries(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tresolvedName\n\t\t\t\tmediaCount\n\t\t\t\tpercentageCompleted\n\t\t\t\tstatus\n\t\t\t\tcreatedAt\n\t\t\t\tmedia(take: 2, skip: 1) {\n\t\t\t\t\tid\n\t\t\t\t\tresolvedName\n\t\t\t\t\tthumbnail {\n\t\t\t\t\t\turl\n\t\t\t\t\t\tmetadata {\n\t\t\t\t\t\t\taverageColor\n\t\t\t\t\t\t\tcolors {\n\t\t\t\t\t\t\t\tcolor\n\t\t\t\t\t\t\t\tpercentage\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\tthumbhash\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\tthumbnail {\n\t\t\t\t\turl\n\t\t\t\t\tmetadata {\n\t\t\t\t\t\taverageColor\n\t\t\t\t\t\tcolors {\n\t\t\t\t\t\t\tcolor\n\t\t\t\t\t\t\tpercentage\n\t\t\t\t\t\t}\n\t\t\t\t\t\tthumbhash\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.RecentlyAddedSeriesDocument,
    "\n\tquery LibraryLayout($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t\tdescription\n\t\t\tpath\n\t\t\tstats {\n\t\t\t\tseriesCount\n\t\t\t\tbookCount\n\t\t\t\tcompletedBooks\n\t\t\t\tinProgressBooks\n\t\t\t\ttotalBytes\n\t\t\t\ttotalReadingTimeSeconds\n\t\t\t}\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t\tmetadata {\n\t\t\t\t\taverageColor\n\t\t\t\t\tthumbhash\n\t\t\t\t\tcolors {\n\t\t\t\t\t\tcolor\n\t\t\t\t\t\tpercentage\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tconfig {\n\t\t\t\tdefaultLibraryViewMode\n\t\t\t\thideSeriesView\n\t\t\t}\n\t\t\t...LibrarySettingsConfig\n\t\t}\n\t}\n": typeof types.LibraryLayoutDocument,
    "\n\tmutation VisitLibrary($id: ID!) {\n\t\tvisitLibrary(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.VisitLibraryDocument,
    "\n\tquery LibraryBooksScene(\n\t\t$filter: MediaFilterInput!\n\t\t$orderBy: [MediaOrderBy!]!\n\t\t$pagination: Pagination!\n\t) {\n\t\tmedia(filter: $filter, orderBy: $orderBy, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...BookCard\n\t\t\t\t...BookMetadata\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.LibraryBooksSceneDocument,
    "\n\tquery LibrarySeries(\n\t\t$filter: SeriesFilterInput!\n\t\t$orderBy: [SeriesOrderBy!]!\n\t\t$pagination: Pagination!\n\t) {\n\t\tseries(filter: $filter, orderBy: $orderBy, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tresolvedName\n\t\t\t\tmediaCount\n\t\t\t\tpercentageCompleted\n\t\t\t\tstatus\n\t\t\t\t# We fetch 2 and skip 1 because the first thumbnail _might_ be the same as the series thumbnail.\n\t\t\t\t# See https://github.com/stumpapp/stump/issues/899\n\t\t\t\tmedia(take: 2, skip: 1) {\n\t\t\t\t\tid\n\t\t\t\t\tthumbnail {\n\t\t\t\t\t\turl\n\t\t\t\t\t\tmetadata {\n\t\t\t\t\t\t\taverageColor\n\t\t\t\t\t\t\tcolors {\n\t\t\t\t\t\t\t\tcolor\n\t\t\t\t\t\t\t\tpercentage\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\tthumbhash\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\tthumbnail {\n\t\t\t\t\turl\n\t\t\t\t\tmetadata {\n\t\t\t\t\t\taverageColor\n\t\t\t\t\t\tcolors {\n\t\t\t\t\t\t\tcolor\n\t\t\t\t\t\t\tpercentage\n\t\t\t\t\t\t}\n\t\t\t\t\t\tthumbhash\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\ttotalPages\n\t\t\t\t\tcurrentPage\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.LibrarySeriesDocument,
    "\n\tquery LibrarySeriesGrid($id: String!, $pagination: Pagination) {\n\t\tseries(filter: { libraryId: { eq: $id } }, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tthumbnail {\n\t\t\t\t\turl\n\t\t\t\t}\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.LibrarySeriesGridDocument,
    "\n\tfragment LibrarySettingsConfig on Library {\n\t\tconfig {\n\t\t\tid\n\t\t\tconvertRarToZip\n\t\t\thardDeleteConversions\n\t\t\tdefaultReadingDir\n\t\t\tdefaultReadingMode\n\t\t\tdefaultReadingImageScaleFit\n\t\t\tdefaultLibraryViewMode\n\t\t\thideSeriesView\n\t\t\tskipBookOverview\n\t\t\tgenerateFileHashes\n\t\t\tgenerateKoreaderHashes\n\t\t\tprocessMetadata\n\t\t\twriteComicinfo\n\t\t\twatch\n\t\t\tautoOrganizeLooseFiles\n\t\t\tlibraryPattern\n\t\t\tlibraryType\n\t\t\tthumbnailConfig {\n\t\t\t\t__typename\n\t\t\t\tresizeMethod {\n\t\t\t\t\t__typename\n\t\t\t\t\t... on ScaleEvenlyByFactor {\n\t\t\t\t\t\tfactor\n\t\t\t\t\t}\n\t\t\t\t\t... on ExactDimensionResize {\n\t\t\t\t\t\twidth\n\t\t\t\t\t\theight\n\t\t\t\t\t}\n\t\t\t\t\t... on ScaledDimensionResize {\n\t\t\t\t\t\tdimension\n\t\t\t\t\t\tsize\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\tformat\n\t\t\t\tquality\n\t\t\t\tpage\n\t\t\t}\n\t\t\tprocessThumbnailColorsEvenWithoutConfig\n\t\t\tignoreRules\n\t\t}\n\t}\n": typeof types.LibrarySettingsConfigFragmentDoc,
    "\n\tmutation LibrarySettingsRouterEditLibraryMutation($id: ID!, $input: CreateOrUpdateLibraryInput!) {\n\t\tupdateLibrary(id: $id, input: $input) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.LibrarySettingsRouterEditLibraryMutationDocument,
    "\n\tmutation LibrarySettingsRouterScanLibraryMutation($id: ID!, $options: JSON) {\n\t\tscanLibrary(id: $id, options: $options)\n\t}\n": typeof types.LibrarySettingsRouterScanLibraryMutationDocument,
    "\n\tquery BasicSettingsSceneExistingLibraries {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\tpath\n\t\t\t}\n\t\t}\n\t}\n": typeof types.BasicSettingsSceneExistingLibrariesDocument,
    "\n\tquery LibraryExclusionsUsersQuery {\n\t\tusers(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n": typeof types.LibraryExclusionsUsersQueryDocument,
    "\n\tquery LibraryExclusionsQuery($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\texcludedUsers {\n\t\t\t\tid\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n": typeof types.LibraryExclusionsQueryDocument,
    "\n\tmutation UpdateLibraryExclusions($id: ID!, $userIds: [String!]!) {\n\t\tupdateLibraryExcludedUsers(id: $id, userIds: $userIds) {\n\t\t\tid\n\t\t\texcludedUsers {\n\t\t\t\tid\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n": typeof types.UpdateLibraryExclusionsDocument,
    "\n\tmutation CleanLibrary($id: ID!) {\n\t\tcleanLibrary(id: $id) {\n\t\t\tdeletedMediaCount\n\t\t\tdeletedSeriesCount\n\t\t\tisEmpty\n\t\t}\n\t}\n": typeof types.CleanLibraryDocument,
    "\n\tquery LibraryMissingEntities($libraryId: ID!, $pagination: Pagination!) {\n\t\tlibraryMissingEntities(libraryId: $libraryId, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tpath\n\t\t\t\ttype\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\ttotalPages\n\t\t\t\t\tcurrentPage\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t\ttotalItems\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.LibraryMissingEntitiesDocument,
    "\n\tmutation AnalyzeLibraryMedia($id: ID!) {\n\t\tanalyzeLibrary(id: $id)\n\t}\n": typeof types.AnalyzeLibraryMediaDocument,
    "\n\tquery InitFetchJobCheckProviders {\n\t\tmetadataProviderConfigs {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.InitFetchJobCheckProvidersDocument,
    "\n\tmutation InitFetchJob($id: ID!) {\n\t\tfetchLibraryMetadata(id: $id)\n\t}\n": typeof types.InitFetchJobDocument,
    "\n\tmutation OrganizeLooseFilesPlan($libraryId: ID!) {\n\t\tplanOrganizeLooseFiles(libraryId: $libraryId)\n\t}\n": typeof types.OrganizeLooseFilesPlanDocument,
    "\n\tmutation OrganizeLooseFilesApply($libraryId: ID!, $decisions: [OrganizeDecisionInput!]!) {\n\t\tapplyOrganizeLooseFiles(libraryId: $libraryId, decisions: $decisions)\n\t}\n": typeof types.OrganizeLooseFilesApplyDocument,
    "\n\tquery OrganizePreview($libraryId: ID!) {\n\t\torganizePreview(libraryId: $libraryId) {\n\t\t\tproposedMoves {\n\t\t\t\tsrc\n\t\t\t\tdst\n\t\t\t\tcanonicalName\n\t\t\t\tyear\n\t\t\t\texternalId\n\t\t\t\tprovider\n\t\t\t\tconfidence\n\t\t\t\tbucket\n\t\t\t\texistingSeriesId\n\t\t\t}\n\t\t\tunmatched {\n\t\t\t\tsrc\n\t\t\t\tparsedSeries\n\t\t\t\treason\n\t\t\t}\n\t\t}\n\t}\n": typeof types.OrganizePreviewDocument,
    "\n\tmutation ScanHistorySectionClearHistory($id: ID!) {\n\t\tclearScanHistory(id: $id)\n\t}\n": typeof types.ScanHistorySectionClearHistoryDocument,
    "\n\tquery ScanHistoryTable($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tid\n\t\t\tscanHistory {\n\t\t\t\tid\n\t\t\t\tjobId\n\t\t\t\ttimestamp\n\t\t\t\toptions\n\t\t\t}\n\t\t}\n\t}\n": typeof types.ScanHistoryTableDocument,
    "\n\tquery ScanRecordInspectorJobs($id: ID!, $loadLogs: Boolean!) {\n\t\tjobById(id: $id) {\n\t\t\tid\n\t\t\toutputData {\n\t\t\t\t__typename\n\t\t\t\t... on LibraryScanOutput {\n\t\t\t\t\ttotalFiles\n\t\t\t\t\ttotalDirectories\n\t\t\t\t\tignoredFiles\n\t\t\t\t\tskippedFiles\n\t\t\t\t\tignoredDirectories\n\t\t\t\t\tcreatedMedia\n\t\t\t\t\tupdatedMedia\n\t\t\t\t\tcreatedSeries\n\t\t\t\t\tupdatedSeries\n\t\t\t\t}\n\t\t\t}\n\t\t\tlogs @include(if: $loadLogs) {\n\t\t\t\tid\n\t\t\t}\n\t\t}\n\t}\n": typeof types.ScanRecordInspectorJobsDocument,
    "\n\tmutation DeleteLibraryThumbnails($id: ID!) {\n\t\tdeleteLibraryThumbnails(id: $id)\n\t}\n": typeof types.DeleteLibraryThumbnailsDocument,
    "\n\tmutation LibraryThumbnailSelectorUpdate($id: ID!, $input: UpdateThumbnailInput!) {\n\t\tupdateLibraryThumbnail(id: $id, input: $input) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": typeof types.LibraryThumbnailSelectorUpdateDocument,
    "\n\tmutation LibraryThumbnailSelectorUpload($id: ID!, $file: Upload!) {\n\t\tuploadLibraryThumbnail(id: $id, file: $file) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": typeof types.LibraryThumbnailSelectorUploadDocument,
    "\n\tmutation ProcessLibraryThumbnails($id: ID!, $forceRegenerate: Boolean!) {\n\t\tprocessLibraryThumbnails(id: $id, forceRegenerate: $forceRegenerate)\n\t}\n": typeof types.ProcessLibraryThumbnailsDocument,
    "\n\tmutation RegenerateThumbnails($id: ID!, $forceRegenerate: Boolean!) {\n\t\tgenerateLibraryThumbnails(id: $id, forceRegenerate: $forceRegenerate)\n\t}\n": typeof types.RegenerateThumbnailsDocument,
    "\n\tmutation SeriesActionComplete($id: ID!) {\n\t\tfinishSeriesProgress(id: $id)\n\t}\n": typeof types.SeriesActionCompleteDocument,
    "\n\tquery SeriesLayout($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\tpath\n\t\t\tlibrary {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tresolvedName\n\t\t\tresolvedDescription\n\t\t\tstats {\n\t\t\t\tbookCount\n\t\t\t\tcompletedBooks\n\t\t\t\tinProgressBooks\n\t\t\t\ttotalBytes\n\t\t\t\ttotalReadingTimeSeconds\n\t\t\t}\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t\tmetadata {\n\t\t\t\t\taverageColor\n\t\t\t\t\tthumbhash\n\t\t\t\t\tcolors {\n\t\t\t\t\t\tcolor\n\t\t\t\t\t\tpercentage\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tcreatedAt\n\t\t\tupdatedAt\n\t\t}\n\t}\n": typeof types.SeriesLayoutDocument,
    "\n\tquery SeriesLibrayLink($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": typeof types.SeriesLibrayLinkDocument,
    "\n\tquery SeriesOverviewSheetExtas($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\tmetadata {\n\t\t\t\tpublisher\n\t\t\t\tyear\n\t\t\t\tsummary\n\t\t\t\tlinks\n\t\t\t}\n\t\t\tupNext(take: 10) {\n\t\t\t\tid\n\t\t\t\t...SimpleBookCard\n\t\t\t}\n\t\t}\n\t}\n": typeof types.SeriesOverviewSheetExtasDocument,
    "\n\tquery SeriesBooksScene(\n\t\t$filter: MediaFilterInput!\n\t\t$orderBy: [MediaOrderBy!]!\n\t\t$pagination: Pagination!\n\t) {\n\t\tmedia(filter: $filter, orderBy: $orderBy, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...BookCard\n\t\t\t\t...BookMetadata\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.SeriesBooksSceneDocument,
    "\n\tquery SeriesBookGrid($id: String!, $pagination: Pagination) {\n\t\tmedia(filter: { seriesId: { eq: $id } }, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tthumbnail {\n\t\t\t\t\turl\n\t\t\t\t}\n\t\t\t\tpages\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.SeriesBookGridDocument,
    "\n\tquery SeriesSettingsScene($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\t...SeriesThumbnailSelector\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tmetadata {\n\t\t\t\t...SeriesMetadataEditor\n\t\t\t}\n\t\t}\n\t}\n": typeof types.SeriesSettingsSceneDocument,
    "\n\tmutation SeriesSettingsSceneAnalyze($id: ID!) {\n\t\tanalyzeSeries(id: $id)\n\t}\n": typeof types.SeriesSettingsSceneAnalyzeDocument,
    "\n\tmutation SeriesSettingsSceneResetMetadata($id: ID!, $impact: MetadataResetImpact!) {\n\t\tresetSeriesMetadata(id: $id, impact: $impact) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.SeriesSettingsSceneResetMetadataDocument,
    "\n\tmutation SeriesTagEditorSetTags($id: ID!, $tags: [String!]!) {\n\t\tsetSeriesTags(id: $id, tags: $tags) {\n\t\t\tid\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t}\n\t}\n": typeof types.SeriesTagEditorSetTagsDocument,
    "\n\tfragment SeriesThumbnailSelector on Series {\n\t\tid\n\t\tthumbnail {\n\t\t\turl\n\t\t}\n\t}\n": typeof types.SeriesThumbnailSelectorFragmentDoc,
    "\n\tmutation SeriesThumbnailSelectorUpdate($id: ID!, $input: UpdateThumbnailInput!) {\n\t\tupdateSeriesThumbnail(id: $id, input: $input) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": typeof types.SeriesThumbnailSelectorUpdateDocument,
    "\n\tmutation SeriesThumbnailSelectorUpload($id: ID!, $file: Upload!) {\n\t\tuploadSeriesThumbnail(id: $id, file: $file) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": typeof types.SeriesThumbnailSelectorUploadDocument,
    "\n\tquery APIKeyTable {\n\t\tapiKeys {\n\t\t\tid\n\t\t\tname\n\t\t\tpermissions {\n\t\t\t\t__typename\n\t\t\t\t... on UserPermissionStruct {\n\t\t\t\t\tvalue\n\t\t\t\t}\n\t\t\t}\n\t\t\tlastUsedAt\n\t\t\texpiresAt\n\t\t\tcreatedAt\n\t\t}\n\t}\n": typeof types.ApiKeyTableDocument,
    "\n\tmutation CreateAPIKeyModal($input: ApikeyInput!) {\n\t\tcreateApiKey(input: $input) {\n\t\t\tapiKey {\n\t\t\t\tid\n\t\t\t}\n\t\t\tsecret\n\t\t}\n\t}\n": typeof types.CreateApiKeyModalDocument,
    "\n\tmutation DeleteAPIKeyConfirmModal($id: Int!) {\n\t\tdeleteApiKey(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.DeleteApiKeyConfirmModalDocument,
    "\n\tmutation UploadUserAvatar($file: Upload!) {\n\t\tuploadUserAvatar(upload: $file) {\n\t\t\tid\n\t\t\tavatarUrl\n\t\t}\n\t}\n": typeof types.UploadUserAvatarDocument,
    "\n\tmutation DeleteUserAvatar {\n\t\tdeleteUserAvatar {\n\t\t\tid\n\t\t\tavatarUrl\n\t\t}\n\t}\n": typeof types.DeleteUserAvatarDocument,
    "\n\tmutation UpdateUserProfileForm($input: UpdateUserInput!) {\n\t\tupdateViewer(input: $input) {\n\t\t\tid\n\t\t\tusername\n\t\t}\n\t}\n": typeof types.UpdateUserProfileFormDocument,
    "\n\tquery NavigationArrangement {\n\t\tme {\n\t\t\tpreferences {\n\t\t\t\tnavigationArrangement {\n\t\t\t\t\tlocked\n\t\t\t\t\tsections {\n\t\t\t\t\t\t__typename\n\t\t\t\t\t\tconfig {\n\t\t\t\t\t\t\t__typename\n\t\t\t\t\t\t\t... on SystemArrangementConfig {\n\t\t\t\t\t\t\t\tvariant\n\t\t\t\t\t\t\t\tlinks\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}\n\t\t\t\t\t\tvisible\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.NavigationArrangementDocument,
    "\n\tmutation NavigationArrangementUpdate($input: NavigationArrangementInput!) {\n\t\tupdateNavigationArrangement(input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n": typeof types.NavigationArrangementUpdateDocument,
    "\n\tmutation NavigationArrangementUpdateLockStatus($locked: Boolean!) {\n\t\tupdateNavigationArrangementLock(locked: $locked) {\n\t\t\t__typename\n\t\t}\n\t}\n": typeof types.NavigationArrangementUpdateLockStatusDocument,
    "\n\tquery CreateEmailerSceneEmailers {\n\t\temailers {\n\t\t\tname\n\t\t}\n\t}\n": typeof types.CreateEmailerSceneEmailersDocument,
    "\n\tmutation CreateEmailerSceneCreateEmailer($input: EmailerInput!) {\n\t\tcreateEmailer(input: $input) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.CreateEmailerSceneCreateEmailerDocument,
    "\n\tquery EditEmailerScene($id: Int!) {\n\t\temailers {\n\t\t\tname\n\t\t}\n\t\temailerById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t\tisPrimary\n\t\t\tsmtpHost\n\t\t\tsmtpPort\n\t\t\tlastUsedAt\n\t\t\tmaxAttachmentSizeBytes\n\t\t\tsenderDisplayName\n\t\t\tsenderEmail\n\t\t\ttlsEnabled\n\t\t\tusername\n\t\t}\n\t}\n": typeof types.EditEmailerSceneDocument,
    "\n\tmutation EditEmailerSceneEditEmailer($id: Int!, $input: EmailerInput!) {\n\t\tupdateEmailer(id: $id, input: $input) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.EditEmailerSceneEditEmailerDocument,
    "\n\tmutation CreateOrUpdateDeviceModalCreateEmailDevice($input: EmailDeviceInput!) {\n\t\tcreateEmailDevice(input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": typeof types.CreateOrUpdateDeviceModalCreateEmailDeviceDocument,
    "\n\tmutation CreateOrUpdateDeviceModalUpdateEmailDevice($id: Int!, $input: EmailDeviceInput!) {\n\t\tupdateEmailDevice(id: $id, input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t\tforbidden\n\t\t}\n\t}\n": typeof types.CreateOrUpdateDeviceModalUpdateEmailDeviceDocument,
    "\n\tmutation DeleteDeviceConfirmationDeleteEmailDevice($id: Int!) {\n\t\tdeleteEmailDevice(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.DeleteDeviceConfirmationDeleteEmailDeviceDocument,
    "\n\tquery EmailDevicesTable {\n\t\temailDevices {\n\t\t\tid\n\t\t\tname\n\t\t\temail\n\t\t\tforbidden\n\t\t}\n\t}\n": typeof types.EmailDevicesTableDocument,
    "\n\tfragment EmailerListItem on Emailer {\n\t\tid\n\t\tname\n\t\tisPrimary\n\t\tsmtpHost\n\t\tsmtpPort\n\t\tlastUsedAt\n\t\tmaxAttachmentSizeBytes\n\t\tsenderDisplayName\n\t\tsenderEmail\n\t\ttlsEnabled\n\t\tusername\n\t}\n": typeof types.EmailerListItemFragmentDoc,
    "\n\tmutation DeleteEmailer($emailerId: Int!) {\n\t\tdeleteEmailer(id: $emailerId) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.DeleteEmailerDocument,
    "\n\tquery EmailerSendHistory($id: Int!, $fetchUser: Boolean!) {\n\t\temailerById(id: $id) {\n\t\t\tsendHistory {\n\t\t\t\tsentAt\n\t\t\t\trecipientEmail\n\t\t\t\tsentByUserId\n\t\t\t\tsentBy @include(if: $fetchUser) {\n\t\t\t\t\tid\n\t\t\t\t\tusername\n\t\t\t\t}\n\t\t\t\tattachmentMeta {\n\t\t\t\t\tfilename\n\t\t\t\t\tmediaId\n\t\t\t\t\tmedia {\n\t\t\t\t\t\tresolvedName\n\t\t\t\t\t}\n\t\t\t\t\tsize\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.EmailerSendHistoryDocument,
    "\n\tquery EmailersList {\n\t\temailers {\n\t\t\tid\n\t\t\t...EmailerListItem\n\t\t}\n\t}\n": typeof types.EmailersListDocument,
    "\n\tmutation TestEmailer($config: EmailerClientConfig!, $recipient: String!) {\n\t\ttestEmailer(config: $config, recipient: $recipient)\n\t}\n": typeof types.TestEmailerDocument,
    "\n\tquery ServerEmojisSection {\n\t\tcustomEmojis {\n\t\t\tid\n\t\t\tname\n\t\t\tisAnimated\n\t\t\turl\n\t\t}\n\t}\n": typeof types.ServerEmojisSectionDocument,
    "\n\tmutation ServerEmojisSectionUploadEmoji($input: CreateCustomEmojiInput!, $upload: Upload!) {\n\t\tuploadCustomEmoji(input: $input, upload: $upload) {\n\t\t\tid\n\t\t\tname\n\t\t\tisAnimated\n\t\t\turl\n\t\t}\n\t}\n": typeof types.ServerEmojisSectionUploadEmojiDocument,
    "\n\tmutation ServerEmojisSectionRenameEmoji($id: ID!, $input: UpdateCustomEmojiInput!) {\n\t\tupdateCustomEmoji(id: $id, input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t\tisAnimated\n\t\t\turl\n\t\t}\n\t}\n": typeof types.ServerEmojisSectionRenameEmojiDocument,
    "\n\tmutation ServerEmojisSectionDeleteEmoji($id: ID!) {\n\t\tdeleteCustomEmoji(id: $id)\n\t}\n": typeof types.ServerEmojisSectionDeleteEmojiDocument,
    "\n\tmutation ServerPublicURLUpdate($publicUrl: String!) {\n\t\tupdatePublicUrl(publicUrl: $publicUrl) {\n\t\t\tpublicUrl\n\t\t}\n\t}\n": typeof types.ServerPublicUrlUpdateDocument,
    "\n\tquery ServerPublicURL {\n\t\tserverConfig {\n\t\t\tpublicUrl\n\t\t}\n\t}\n": typeof types.ServerPublicUrlDocument,
    "\n\tquery ServerStats {\n\t\tnumberOfLibraries\n\t\tnumberOfSeries\n\t\tmediaCount\n\t\tmediaDiskUsage\n\t}\n": typeof types.ServerStatsDocument,
    "\n\tmutation CreateScheduledJob($input: CreateScheduledJobInput!) {\n\t\tcreateScheduledJob(input: $input) {\n\t\t\t...ScheduledJobRow\n\t\t}\n\t}\n": typeof types.CreateScheduledJobDocument,
    "\n\tmutation UpdateScheduledJob($id: Int!, $input: UpdateScheduledJobInput!) {\n\t\tupdateScheduledJob(id: $id, input: $input) {\n\t\t\t...ScheduledJobRow\n\t\t}\n\t}\n": typeof types.UpdateScheduledJobDocument,
    "\n\tmutation DeleteJobHistoryConfirmation {\n\t\tdeleteJobHistory {\n\t\t\taffectedRows\n\t\t}\n\t}\n": typeof types.DeleteJobHistoryConfirmationDocument,
    "\n\tmutation JobActionMenuCancelJob($id: ID!) {\n\t\tcancelJob(id: $id)\n\t}\n": typeof types.JobActionMenuCancelJobDocument,
    "\n\tmutation JobActionMenuDeleteJob($id: ID!) {\n\t\tcancelJob(id: $id)\n\t}\n": typeof types.JobActionMenuDeleteJobDocument,
    "\n\tmutation JobActionMenuDeleteLogs($id: ID!) {\n\t\tdeleteJobLogs(id: $id) {\n\t\t\taffectedRows\n\t\t}\n\t}\n": typeof types.JobActionMenuDeleteLogsDocument,
    "\n\tfragment JobDataInspector on CoreJobOutput {\n\t\t__typename\n\t\t... on LibraryScanOutput {\n\t\t\ttotalFiles\n\t\t\ttotalDirectories\n\t\t\tignoredFiles\n\t\t\tskippedFiles\n\t\t\tignoredDirectories\n\t\t\tcreatedMedia\n\t\t\tupdatedMedia\n\t\t\tcreatedSeries\n\t\t\tupdatedSeries\n\t\t}\n\t\t... on SeriesScanOutput {\n\t\t\ttotalFiles\n\t\t\tignoredFiles\n\t\t\tskippedFiles\n\t\t\tcreatedMedia\n\t\t\tupdatedMedia\n\t\t}\n\t\t... on ThumbnailGenerationOutput {\n\t\t\tvisitedFiles\n\t\t\tskippedFiles\n\t\t\tgeneratedThumbnails\n\t\t\tremovedThumbnails\n\t\t}\n\t}\n": typeof types.JobDataInspectorFragmentDoc,
    "\n\tquery ScheduledJobs {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\temoji\n\t\t\t}\n\t\t}\n\t\tscheduledJobs {\n\t\t\tid\n\t\t\tname\n\t\t\t...ScheduledJobRow\n\t\t}\n\t}\n": typeof types.ScheduledJobsDocument,
    "\n\tmutation DeleteScheduledJob($id: Int!) {\n\t\tdeleteScheduledJob(id: $id)\n\t}\n": typeof types.DeleteScheduledJobDocument,
    "\n\tquery JobTable($pagination: Pagination!) {\n\t\tjobs(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\tdescription\n\t\t\t\tstatus\n\t\t\t\tcreatedAt\n\t\t\t\tcompletedAt\n\t\t\t\tmsElapsed\n\t\t\t\toutputData {\n\t\t\t\t\t...JobDataInspector\n\t\t\t\t}\n\t\t\t\tlogCount\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.JobTableDocument,
    "\n\tfragment ScheduledJobRow on ScheduledJob {\n\t\tid\n\t\tname\n\t\tkind\n\t\tschedule\n\t\tconfig\n\t\tenabled\n\t\tcreatedAt\n\t\tlastRunAt\n\t}\n": typeof types.ScheduledJobRowFragmentDoc,
    "\n\tsubscription LiveLogsFeed {\n\t\ttailLogFile\n\t}\n": typeof types.LiveLogsFeedDocument,
    "\n\tmutation DeleteLogs {\n\t\tdeleteLogs {\n\t\t\tdeleted\n\t\t}\n\t}\n": typeof types.DeleteLogsDocument,
    "\n\tquery PersistedLogs(\n\t\t$filter: LogFilterInput!\n\t\t$pagination: Pagination!\n\t\t$orderBy: [LogModelOrderBy!]!\n\t) {\n\t\tlogs(filter: $filter, pagination: $pagination, orderBy: $orderBy) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\ttimestamp\n\t\t\t\tlevel\n\t\t\t\tmessage\n\t\t\t\tjobId\n\t\t\t\tcontext\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\ttotalPages\n\t\t\t\t\tcurrentPage\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.PersistedLogsDocument,
    "\n\tmutation CreateProviderDialogCreateProvider($input: CreateMetadataProviderConfigInput!) {\n\t\tcreateMetadataProvider(input: $input) {\n\t\t\tid\n\t\t\tproviderType\n\t\t\tenabled\n\t\t}\n\t}\n": typeof types.CreateProviderDialogCreateProviderDocument,
    "\n\tmutation EditProviderDialog($id: Int!, $input: PatchMetadataProviderConfigInput!) {\n\t\tupdateMetadataProvider(id: $id, input: $input) {\n\t\t\tid\n\t\t\t...ExistingProviderCard\n\t\t}\n\t}\n": typeof types.EditProviderDialogDocument,
    "\n\tmutation DeleteProviderDialog($id: Int!) {\n\t\tdeleteMetadataProvider(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.DeleteProviderDialogDocument,
    "\n\tfragment ExistingProviderCard on MetadataProviderConfigModel {\n\t\tid\n\t\tproviderType\n\t\tenabled\n\t\tapiTokenExpiresAt\n\t\tautoApplyConfig\n\t\tcreatedAt\n\t\tupdatedAt\n\t}\n": typeof types.ExistingProviderCardFragmentDoc,
    "\n\tquery ProvidersSectionGetProviders {\n\t\tmetadataProviderConfigs {\n\t\t\tid\n\t\t\tproviderType\n\t\t\tposition\n\t\t\t...ExistingProviderCard\n\t\t}\n\t}\n": typeof types.ProvidersSectionGetProvidersDocument,
    "\n\tmutation ProvidersSectionSetPreferred($id: Int!, $input: PatchMetadataProviderConfigInput!) {\n\t\tupdateMetadataProvider(id: $id, input: $input) {\n\t\t\tid\n\t\t\tposition\n\t\t}\n\t}\n": typeof types.ProvidersSectionSetPreferredDocument,
    "\n\tmutation CreateTagModal($tags: [String!]!) {\n\t\tcreateTags(tags: $tags) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": typeof types.CreateTagModalDocument,
    "\n\tmutation DeleteTagConfirmModal($tags: [String!]!) {\n\t\tdeleteTags(tags: $tags) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": typeof types.DeleteTagConfirmModalDocument,
    "\n\tmutation RenameTagModal($id: Int!, $name: String!) {\n\t\trenameTag(id: $id, name: $name) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": typeof types.RenameTagModalDocument,
    "\n\tquery TagTable {\n\t\ttags {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": typeof types.TagTableDocument,
    "\n\tquery UserStats {\n\t\tuserCount\n\t\ttopReaders(take: 1) {\n\t\t\tid\n\t\t\tusername\n\t\t\tfinishedReadingSessionsCount\n\t\t}\n\t\tactiveReadingSessionCount\n\t\tfinishedReadingSessionCount\n\t}\n": typeof types.UserStatsDocument,
    "\n\tmutation CreateOrUpdateUserFormUpdateUser($id: ID!, $input: UpdateUserInput!) {\n\t\tupdateUser(id: $id, input: $input) {\n\t\t\tid\n\t\t\tusername\n\t\t\tageRestriction {\n\t\t\t\tage\n\t\t\t\trestrictOnUnset\n\t\t\t}\n\t\t\tpermissions\n\t\t\tmaxSessionsAllowed\n\t\t}\n\t}\n": typeof types.CreateOrUpdateUserFormUpdateUserDocument,
    "\n\tmutation CreateOrUpdateUserFormCreateUser($input: CreateUserInput!) {\n\t\tcreateUser(input: $input) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.CreateOrUpdateUserFormCreateUserDocument,
    "\n\tquery CreateUserScene {\n\t\tusers(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n": typeof types.CreateUserSceneDocument,
    "\n\tquery UpdateUserScene($id: ID!, $skip: Boolean!) {\n\t\tme {\n\t\t\tid\n\t\t}\n\t\tuserById(id: $id) @skip(if: $skip) {\n\t\t\tid\n\t\t\tavatarUrl\n\t\t\tusername\n\t\t\tageRestriction {\n\t\t\t\tage\n\t\t\t\trestrictOnUnset\n\t\t\t}\n\t\t\tpermissions\n\t\t\tmaxSessionsAllowed\n\t\t\tisServerOwner\n\t\t}\n\t\tusers(pagination: { none: { unpaginated: true } }) @skip(if: $skip) {\n\t\t\tnodes {\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n": typeof types.UpdateUserSceneDocument,
    "\n\tmutation ClearLoginActivityConfirmation {\n\t\tdeleteLoginActivity\n\t}\n": typeof types.ClearLoginActivityConfirmationDocument,
    "\n\tquery LoginActivityTable {\n\t\tloginActivity {\n\t\t\tid\n\t\t\tipAddress\n\t\t\tuserAgent\n\t\t\tauthenticationSuccessful\n\t\t\ttimestamp\n\t\t\tuser {\n\t\t\t\tid\n\t\t\t\tusername\n\t\t\t\tavatarUrl\n\t\t\t}\n\t\t}\n\t}\n": typeof types.LoginActivityTableDocument,
    "\n\tmutation DeleteUser($id: ID!, $hardDelete: Boolean) {\n\t\tdeleteUser(id: $id, hardDelete: $hardDelete) {\n\t\t\tid\n\t\t}\n\t}\n": typeof types.DeleteUserDocument,
    "\n\tmutation UserActionMenuLockUser($id: ID!, $lock: Boolean!) {\n\t\tupdateUserLockStatus(id: $id, lock: $lock) {\n\t\t\tid\n\t\t\tisLocked\n\t\t}\n\t}\n": typeof types.UserActionMenuLockUserDocument,
    "\n\tmutation UserActionMenuDeleteUserSessions($id: ID!) {\n\t\tdeleteUserSessions(id: $id)\n\t}\n": typeof types.UserActionMenuDeleteUserSessionsDocument,
    "\n\tquery UserTable($pagination: Pagination!) {\n\t\tusers(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tavatarUrl\n\t\t\t\tusername\n\t\t\t\tisServerOwner\n\t\t\t\tisLocked\n\t\t\t\tcreatedAt\n\t\t\t\tlastLogin\n\t\t\t\tloginSessionsCount\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\ttotalPages\n\t\t\t\t\tcurrentPage\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.UserTableDocument,
    "\n\tfragment SmartListCard on SmartList {\n\t\tid\n\t\tdescription\n\t\tfilters\n\t\tjoiner\n\t\tname\n\t}\n": typeof types.SmartListCardFragmentDoc,
    "\n\tquery SmartListsWithSearch($input: SmartListsInput!) {\n\t\tsmartLists(input: $input) {\n\t\t\tid\n\t\t\tcreatorId\n\t\t\tdescription\n\t\t\tdefaultGrouping\n\t\t\tfilters\n\t\t\tjoiner\n\t\t\tname\n\t\t\tvisibility\n\t\t\t...SmartListCard\n\t\t}\n\t}\n": typeof types.SmartListsWithSearchDocument,
    "\n\tquery SmartListById($id: ID!) {\n\t\tsmartListById(id: $id) {\n\t\t\tid\n\t\t\tcreatorId\n\t\t\tdescription\n\t\t\tdefaultGrouping\n\t\t\tfilters\n\t\t\tjoiner\n\t\t\tname\n\t\t\tvisibility\n\t\t\tviews {\n\t\t\t\tid\n\t\t\t\tlistId\n\t\t\t\tname\n\t\t\t\tbookColumns {\n\t\t\t\t\tid\n\t\t\t\t\tposition\n\t\t\t\t}\n\t\t\t\tbookSorting {\n\t\t\t\t\tid\n\t\t\t\t\tdesc\n\t\t\t\t}\n\t\t\t\tgroupColumns {\n\t\t\t\t\tid\n\t\t\t\t\tposition\n\t\t\t\t}\n\t\t\t\tgroupSorting {\n\t\t\t\t\tid\n\t\t\t\t\tdesc\n\t\t\t\t}\n\t\t\t\tsearch\n\t\t\t}\n\t\t}\n\t}\n": typeof types.SmartListByIdDocument,
    "\n\tquery SmartListMeta($id: ID!) {\n\t\tsmartListMeta(id: $id) {\n\t\t\tmatchedBooks\n\t\t\tmatchedSeries\n\t\t\tmatchedLibraries\n\t\t}\n\t}\n": typeof types.SmartListMetaDocument,
    "\n\tmutation UpdateSmartList($id: ID!, $input: SaveSmartListInput!) {\n\t\tupdateSmartList(id: $id, input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n": typeof types.UpdateSmartListDocument,
    "\n\tquery SmartListItems($id: ID!) {\n\t\tsmartListItems(id: $id) {\n\t\t\t__typename\n\t\t\t... on SmartListGrouped {\n\t\t\t\titems {\n\t\t\t\t\tentity {\n\t\t\t\t\t\t__typename\n\t\t\t\t\t\t... on Series {\n\t\t\t\t\t\t\tid\n\t\t\t\t\t\t\tname\n\t\t\t\t\t\t}\n\t\t\t\t\t\t... on Library {\n\t\t\t\t\t\t\tid\n\t\t\t\t\t\t\tname\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t\tbooks {\n\t\t\t\t\t\t...BookCard\n\t\t\t\t\t\t...BookMetadata\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\t... on SmartListUngrouped {\n\t\t\t\tbooks {\n\t\t\t\t\t...BookCard\n\t\t\t\t\t...SmartListItemBookMetadata\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.SmartListItemsDocument,
    "\n\tfragment SmartListItemBookMetadata on Media {\n\t\tmetadata {\n\t\t\tageRating\n\t\t\tcharacters\n\t\t\tcolorists\n\t\t\tcoverArtists\n\t\t\teditors\n\t\t\tgenres\n\t\t\tinkers\n\t\t\tletterers\n\t\t\tlinks\n\t\t\tpencillers\n\t\t\tpublisher\n\t\t\tteams\n\t\t\twriters\n\t\t\tyear\n\t\t\tmonth\n\t\t\tday\n\t\t\tformat\n\t\t\tidentifierAmazon\n\t\t\tidentifierCalibre\n\t\t\tidentifierGoogle\n\t\t\tidentifierIsbn\n\t\t\tidentifierMobiAsin\n\t\t\tidentifierUuid\n\t\t\tlanguage\n\t\t\tnotes\n\t\t\tnumber\n\t\t\tpageCount\n\t\t\tseries\n\t\t\tseriesGroup\n\t\t\tstoryArc\n\t\t\tstoryArcNumber\n\t\t\ttitle\n\t\t\ttitleSort\n\t\t\tvolume\n\t\t}\n\t}\n": typeof types.SmartListItemBookMetadataFragmentDoc,
    "\n\tmutation CreateSmartListView($input: SaveSmartListView!) {\n\t\tcreateSmartListView(input: $input) {\n\t\t\tid\n\t\t\tlistId\n\t\t\tname\n\t\t\tsearch\n\t\t\tenableMultiSort\n\t\t\tbookColumns {\n\t\t\t\tid\n\t\t\t\tposition\n\t\t\t}\n\t\t\tbookSorting {\n\t\t\t\tid\n\t\t\t\tdesc\n\t\t\t}\n\t\t\tgroupColumns {\n\t\t\t\tid\n\t\t\t\tposition\n\t\t\t}\n\t\t\tgroupSorting {\n\t\t\t\tid\n\t\t\t\tdesc\n\t\t\t}\n\t\t}\n\t}\n": typeof types.CreateSmartListViewDocument,
    "\n\tmutation UpdateSmartListView($originalName: String!, $input: SaveSmartListView!) {\n\t\tupdateSmartListView(originalName: $originalName, input: $input) {\n\t\t\tid\n\t\t\tlistId\n\t\t\tname\n\t\t\tsearch\n\t\t\tenableMultiSort\n\t\t\tbookColumns {\n\t\t\t\tid\n\t\t\t\tposition\n\t\t\t}\n\t\t\tbookSorting {\n\t\t\t\tid\n\t\t\t\tdesc\n\t\t\t}\n\t\t\tgroupColumns {\n\t\t\t\tid\n\t\t\t\tposition\n\t\t\t}\n\t\t\tgroupSorting {\n\t\t\t\tid\n\t\t\t\tdesc\n\t\t\t}\n\t\t}\n\t}\n": typeof types.UpdateSmartListViewDocument,
    "\n\tmutation DeleteSmartListView($id: ID!, $name: String!) {\n\t\tdeleteSmartListView(id: $id, name: $name) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": typeof types.DeleteSmartListViewDocument,
    "\n\tquery SmartListBasicSettingsScene {\n\t\tsmartLists(input: { mine: true }) {\n\t\t\tname\n\t\t}\n\t}\n": typeof types.SmartListBasicSettingsSceneDocument,
    "\n\tmutation DeleteSmartList($id: ID!) {\n\t\tdeleteSmartList(id: $id) {\n\t\t\t__typename\n\t\t}\n\t}\n": typeof types.DeleteSmartListDocument,
    "\n\tquery DirectoryListing($input: DirectoryListingInput!, $pagination: Pagination!) {\n\t\tlistDirectory(input: $input, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tparent\n\t\t\t\tfiles {\n\t\t\t\t\tname\n\t\t\t\t\tpath\n\t\t\t\t\tisDirectory\n\t\t\t\t\tmedia {\n\t\t\t\t\t\tid\n\t\t\t\t\t\tresolvedName\n\t\t\t\t\t\tthumbnail {\n\t\t\t\t\t\t\turl\n\t\t\t\t\t\t}\n\t\t\t\t\t\textension\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": typeof types.DirectoryListingDocument,
    "\n\tquery UploadConfig {\n\t\tuploadConfig {\n\t\t\tenabled\n\t\t\tmaxFileUploadSize\n\t\t}\n\t}\n": typeof types.UploadConfigDocument,
};
const documents: Documents = {
    "\n\tquery TagSelectQuery {\n\t\ttags {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": types.TagSelectQueryDocument,
    "\n\tfragment BookCard on Media {\n\t\tid\n\t\tresolvedName\n\t\textension\n\t\tpages\n\t\tsize\n\t\tstatus\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t\theight\n\t\t\twidth\n\t\t}\n\t\treadProgress {\n\t\t\tpercentageCompleted\n\t\t\tepubcfi\n\t\t\tpage\n\t\t\tupdatedAt\n\t\t}\n\t\treadHistory {\n\t\t\t__typename\n\t\t\tcompletedAt\n\t\t}\n\t\tcreatedAt\n\t\tlibraryConfig {\n\t\t\tskipBookOverview\n\t\t}\n\t}\n": types.BookCardFragmentDoc,
    "\n\tquery BookSearchOverlay($pagination: Pagination, $filter: MediaFilterInput!) {\n\t\tmedia(pagination: $pagination, filter: $filter) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...BookCard\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.BookSearchOverlayDocument,
    "\n\tfragment SimpleBookCard on Media {\n\t\tid\n\t\tresolvedName\n\t\tcreatedAt\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t}\n\t}\n": types.SimpleBookCardFragmentDoc,
    "\n\tfragment MediaMetadataEditor on MediaMetadata {\n\t\tageRating\n\t\tcharacters\n\t\tcolorists\n\t\tcoverArtists\n\t\tday\n\t\teditors\n\t\tformat\n\t\tidentifierAmazon\n\t\tidentifierCalibre\n\t\tidentifierGoogle\n\t\tidentifierIsbn\n\t\tidentifierMobiAsin\n\t\tidentifierUuid\n\t\tgenres\n\t\tinkers\n\t\tlanguage\n\t\tletterers\n\t\tlinks\n\t\tmonth\n\t\tnotes\n\t\tnumber\n\t\tpageCount\n\t\tpencillers\n\t\tpublisher\n\t\tseries\n\t\tseriesGroup\n\t\tstoryArc\n\t\tstoryArcNumber\n\t\tsummary\n\t\tteams\n\t\ttitle\n\t\ttitleSort\n\t\tvolume\n\t\twriters\n\t\tyear\n\t\tlockedFields\n\t}\n": types.MediaMetadataEditorFragmentDoc,
    "\n\tmutation UpdateMediaMetadata($id: ID!, $input: MediaMetadataInput!) {\n\t\tupdateMediaMetadata(id: $id, input: $input) {\n\t\t\tmetadata {\n\t\t\t\t...MediaMetadataEditor\n\t\t\t}\n\t\t}\n\t}\n": types.UpdateMediaMetadataDocument,
    "\n\tmutation MediaEditorSetLockedFields($mediaId: ID!, $lockedFields: [MetadataField!]!) {\n\t\tsetMediaLockedFields(mediaId: $mediaId, lockedFields: $lockedFields) {\n\t\t\tid\n\t\t}\n\t}\n": types.MediaEditorSetLockedFieldsDocument,
    "\n\tquery BookOverviewScene($id: ID!) {\n\t\tmediaById(id: $id) {\n\t\t\tid\n\t\t\t...BookCard\n\t\t\t...BookFileInformation\n\t\t\tresolvedName\n\t\t\textension\n\t\t\tseriesId\n\t\t\tpages\n\t\t\tsize\n\t\t\tmetadata {\n\t\t\t\tlinks\n\t\t\t\tsummary\n\t\t\t\tageRating\n\t\t\t\tgenres\n\t\t\t\tlanguage\n\t\t\t\tpublisher\n\t\t\t\twriters\n\t\t\t\tyear\n\t\t\t\t...MediaMetadataEditor\n\t\t\t}\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\treadHistory {\n\t\t\t\tcompletedAt\n\t\t\t}\n\t\t}\n\t}\n": types.BookOverviewSceneDocument,
    "\n\tmutation DeleteBookClubConfirmation($id: ID!) {\n\t\tdeleteBookClub(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n": types.DeleteBookClubConfirmationDocument,
    "\n\tfragment BookClubBookItem on BookClubBook {\n\t\tid\n\t\ttitle\n\t\tauthor\n\t\timageUrl\n\t\turl\n\t\tentity {\n\t\t\t__typename\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tmetadata {\n\t\t\t\twriters\n\t\t\t}\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t\tcompletedAt\n\t\taddedAt\n\t}\n": types.BookClubBookItemFragmentDoc,
    "\n\tquery BookClubBooksScene($id: ID!) {\n\t\tbookClubById(id: $id) {\n\t\t\tid\n\t\t\tpreviousBooks {\n\t\t\t\tid\n\t\t\t\t...BookClubBookItem\n\t\t\t}\n\t\t}\n\t}\n": types.BookClubBooksSceneDocument,
    "\n\tquery MediaAtPath($path: String!) {\n\t\tmediaByPath(path: $path) {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": types.MediaAtPathDocument,
    "\n\tmutation UploadLibraryBooks($input: UploadBooksInput!) {\n\t\tuploadBooks(input: $input)\n\t}\n": types.UploadLibraryBooksDocument,
    "\n\tmutation UploadLibrarySeries($input: UploadSeriesInput!) {\n\t\tuploadSeries(input: $input)\n\t}\n": types.UploadLibrarySeriesDocument,
    "\n\tquery MediaFilterForm($seriesId: ID) {\n\t\tmediaMetadataOverview(seriesId: $seriesId) {\n\t\t\tgenres\n\t\t\twriters\n\t\t\tpencillers\n\t\t\tcolorists\n\t\t\tletterers\n\t\t\tinkers\n\t\t\tpublishers\n\t\t\teditors\n\t\t\tcharacters\n\t\t}\n\t}\n": types.MediaFilterFormDocument,
    "\n\tmutation DeleteLibrary($id: ID!) {\n\t\tdeleteLibrary(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n": types.DeleteLibraryDocument,
    "\n\tquery LastVisitedLibrary {\n\t\tlastVisitedLibrary {\n\t\t\tid\n\t\t\tname\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": types.LastVisitedLibraryDocument,
    "\n\tquery LibraryBooksAlphabet($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tmediaAlphabet\n\t\t}\n\t}\n": types.LibraryBooksAlphabetDocument,
    "\n\tquery LibrarySeriesAlphabet($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tseriesAlphabet\n\t\t}\n\t}\n": types.LibrarySeriesAlphabetDocument,
    "\n\tfragment PendingMatchRecord on MetadataFetchRecord {\n\t\tid\n\t\tstatus\n\t\tmediaId\n\t\tseriesId\n\t\tmatchCandidates {\n\t\t\tprovider\n\t\t\texternalId\n\t\t\tmetadata {\n\t\t\t\t__typename\n\t\t\t\t... on ExternalMediaMetadata {\n\t\t\t\t\ttitle\n\t\t\t\t\tseriesName\n\t\t\t\t\tseriesExternalId\n\t\t\t\t\tsummary\n\t\t\t\t\tpageCount\n\t\t\t\t\tnumber\n\t\t\t\t\tday\n\t\t\t\t\tmonth\n\t\t\t\t\tyear\n\t\t\t\t\tgenres\n\t\t\t\t\ttags\n\t\t\t\t\tisbn\n\t\t\t\t\tisbn13\n\t\t\t\t\twriters\n\t\t\t\t\tartists\n\t\t\t\t\tcolorists\n\t\t\t\t\tletterers\n\t\t\t\t\tcoverArtists\n\t\t\t\t}\n\t\t\t\t... on ExternalSeriesMetadata {\n\t\t\t\t\tseriesTitle: title\n\t\t\t\t\talternativeTitles\n\t\t\t\t\tsummary\n\t\t\t\t\tvolumeCount\n\t\t\t\t\tcoverUrl\n\t\t\t\t\tstatus\n\t\t\t\t\tyear\n\t\t\t\t\tendYear\n\t\t\t\t\tgenres\n\t\t\t\t\ttags\n\t\t\t\t\tauthors\n\t\t\t\t\tageRating\n\t\t\t\t\tpublisher\n\t\t\t\t}\n\t\t\t}\n\t\t\tconfidence\n\t\t\tconfidenceFactors {\n\t\t\t\tfactor\n\t\t\t\tweight\n\t\t\t\tmatched\n\t\t\t}\n\t\t}\n\t\taddedAt\n\t\tupdatedAt\n\t\tmedia {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tmetadata {\n\t\t\t\ttitle\n\t\t\t\tsummary\n\t\t\t\tgenres\n\t\t\t\twriters\n\t\t\t\tcolorists\n\t\t\t\tletterers\n\t\t\t\tcoverArtists\n\t\t\t\tpublisher\n\t\t\t\tyear\n\t\t\t\tmonth\n\t\t\t\tday\n\t\t\t\tpageCount\n\t\t\t\tidentifierIsbn\n\t\t\t\tlockedFields\n\t\t\t}\n\t\t}\n\t\tseries {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tmetadata {\n\t\t\t\ttitle\n\t\t\t\tsummary\n\t\t\t\tgenres\n\t\t\t\twriters\n\t\t\t\tpublisher\n\t\t\t\tyear\n\t\t\t\tstatus\n\t\t\t\tageRating\n\t\t\t\tvolume\n\t\t\t\tlockedFields\n\t\t\t}\n\t\t}\n\t}\n": types.PendingMatchRecordFragmentDoc,
    "\n\tquery PendingMetadataMatches {\n\t\tpendingMetadataMatches {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n": types.PendingMetadataMatchesDocument,
    "\n\tmutation AcceptAllPendingMatches($strategy: MergeStrategy, $excludeFields: [MetadataField!]) {\n\t\tacceptAllPendingMatches(strategy: $strategy, excludeFields: $excludeFields)\n\t}\n": types.AcceptAllPendingMatchesDocument,
    "\n\tmutation RejectAllPendingMatches {\n\t\trejectAllPendingMatches\n\t}\n": types.RejectAllPendingMatchesDocument,
    "\n\tmutation AcceptMediaMatch(\n\t\t$mediaId: ID!\n\t\t$candidateIndex: Int!\n\t\t$strategy: MergeStrategy\n\t\t$excludeFields: [MetadataField!]\n\t\t$overrides: [MetadataFieldOverride!]\n\t) {\n\t\tacceptMediaMatch(\n\t\t\tmediaId: $mediaId\n\t\t\tcandidateIndex: $candidateIndex\n\t\t\tstrategy: $strategy\n\t\t\texcludeFields: $excludeFields\n\t\t\toverrides: $overrides\n\t\t) {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n": types.AcceptMediaMatchDocument,
    "\n\tmutation AcceptSeriesMatch(\n\t\t$seriesId: ID!\n\t\t$candidateIndex: Int!\n\t\t$strategy: MergeStrategy\n\t\t$excludeFields: [MetadataField!]\n\t\t$overrides: [MetadataFieldOverride!]\n\t) {\n\t\tacceptSeriesMatch(\n\t\t\tseriesId: $seriesId\n\t\t\tcandidateIndex: $candidateIndex\n\t\t\tstrategy: $strategy\n\t\t\texcludeFields: $excludeFields\n\t\t\toverrides: $overrides\n\t\t) {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n": types.AcceptSeriesMatchDocument,
    "\n\tmutation RejectMediaMatch($mediaId: ID!, $candidateIndex: Int!) {\n\t\trejectMediaMatch(mediaId: $mediaId, candidateIndex: $candidateIndex) {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n": types.RejectMediaMatchDocument,
    "\n\tmutation RejectSeriesMatch($seriesId: ID!, $candidateIndex: Int!) {\n\t\trejectSeriesMatch(seriesId: $seriesId, candidateIndex: $candidateIndex) {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n": types.RejectSeriesMatchDocument,
    "\n\tmutation SetMediaLockedFields($mediaId: ID!, $lockedFields: [MetadataField!]!) {\n\t\tsetMediaLockedFields(mediaId: $mediaId, lockedFields: $lockedFields) {\n\t\t\tid\n\t\t}\n\t}\n": types.SetMediaLockedFieldsDocument,
    "\n\tmutation SetSeriesLockedFields($seriesId: ID!, $lockedFields: [MetadataField!]!) {\n\t\tsetSeriesLockedFields(seriesId: $seriesId, lockedFields: $lockedFields) {\n\t\t\tid\n\t\t}\n\t}\n": types.SetSeriesLockedFieldsDocument,
    "\n\tquery ProviderMatchMediaContext($id: ID!) {\n\t\tmediaById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t\tresolvedName\n\t\t}\n\t}\n": types.ProviderMatchMediaContextDocument,
    "\n\tquery ProviderMatchSeriesContext($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t\tresolvedName\n\t\t}\n\t}\n": types.ProviderMatchSeriesContextDocument,
    "\n\tquery ProviderMatchParse($name: String!) {\n\t\tparseComicFilename(name: $name) {\n\t\t\tseries\n\t\t\tnumber\n\t\t\tyear\n\t\t}\n\t}\n": types.ProviderMatchParseDocument,
    "\n\tquery ProviderMatchProviders {\n\t\tmetadataProviderConfigs {\n\t\t\tid\n\t\t\tproviderType\n\t\t\tenabled\n\t\t\tposition\n\t\t}\n\t}\n": types.ProviderMatchProvidersDocument,
    "\n\tmutation ProviderMatchFindMedia(\n\t\t$id: ID!\n\t\t$query: MetadataSearchInput\n\t\t$provider: MetadataProvider\n\t) {\n\t\tfetchMediaMetadata(id: $id, query: $query, provider: $provider, autoApply: false) {\n\t\t\tprovider\n\t\t\texternalId\n\t\t\tconfidence\n\t\t\tmetadata {\n\t\t\t\t__typename\n\t\t\t\t... on ExternalMediaMetadata {\n\t\t\t\t\ttitle\n\t\t\t\t\tseriesName\n\t\t\t\t\tnumberRaw\n\t\t\t\t\tyear\n\t\t\t\t\tpublisher\n\t\t\t\t\twriters\n\t\t\t\t\tcoverUrl\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.ProviderMatchFindMediaDocument,
    "\n\tmutation ProviderMatchFindSeries(\n\t\t$id: ID!\n\t\t$query: MetadataSearchInput\n\t\t$provider: MetadataProvider\n\t) {\n\t\tfetchSeriesMetadata(id: $id, query: $query, provider: $provider, autoApply: false) {\n\t\t\tprovider\n\t\t\texternalId\n\t\t\tconfidence\n\t\t\tmetadata {\n\t\t\t\t__typename\n\t\t\t\t... on ExternalSeriesMetadata {\n\t\t\t\t\ttitle\n\t\t\t\t\tyear\n\t\t\t\t\tpublisher\n\t\t\t\t\tauthors\n\t\t\t\t\tcoverUrl\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.ProviderMatchFindSeriesDocument,
    "\n\tmutation ProviderMatchAcceptMedia($mediaId: ID!, $candidateIndex: Int!) {\n\t\tacceptMediaMatch(mediaId: $mediaId, candidateIndex: $candidateIndex) {\n\t\t\tid\n\t\t\tstatus\n\t\t}\n\t}\n": types.ProviderMatchAcceptMediaDocument,
    "\n\tmutation ProviderMatchAcceptSeries($seriesId: ID!, $candidateIndex: Int!) {\n\t\tacceptSeriesMatch(seriesId: $seriesId, candidateIndex: $candidateIndex) {\n\t\t\tid\n\t\t\tstatus\n\t\t}\n\t}\n": types.ProviderMatchAcceptSeriesDocument,
    "\n\tquery SideBarQuery {\n\t\tme {\n\t\t\tid\n\t\t\tpreferences {\n\t\t\t\tnavigationArrangement {\n\t\t\t\t\tlocked\n\t\t\t\t\tsections {\n\t\t\t\t\t\tconfig {\n\t\t\t\t\t\t\t__typename\n\t\t\t\t\t\t\t... on SystemArrangementConfig {\n\t\t\t\t\t\t\t\tvariant\n\t\t\t\t\t\t\t\tlinks\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}\n\t\t\t\t\t\tvisible\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.SideBarQueryDocument,
    "\n\tquery BookClubSideBarSection {\n\t\tbookClubs {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t\temoji\n\t\t\tmembers {\n\t\t\t\tid\n\t\t\t\tuserId\n\t\t\t\trole\n\t\t\t}\n\t\t}\n\t}\n": types.BookClubSideBarSectionDocument,
    "\n\tmutation UpdateLibraryEmoji($id: ID!, $emoji: String) {\n\t\tupdateLibraryEmoji(id: $id, emoji: $emoji) {\n\t\t\tid\n\t\t}\n\t}\n": types.UpdateLibraryEmojiDocument,
    "\n\tmutation ScanLibraryMutation($id: ID!) {\n\t\tscanLibrary(id: $id)\n\t}\n": types.ScanLibraryMutationDocument,
    "\n\tquery LibrarySideBarSection {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\temoji\n\t\t\t}\n\t\t}\n\t}\n": types.LibrarySideBarSectionDocument,
    "\n\tquery SmartListSideBarSection {\n\t\tsmartLists {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": types.SmartListSideBarSectionDocument,
    "\n\tquery TopNavigation {\n\t\tme {\n\t\t\tid\n\t\t\tpreferences {\n\t\t\t\tnavigationArrangement {\n\t\t\t\t\tlocked\n\t\t\t\t\tsections {\n\t\t\t\t\t\tconfig {\n\t\t\t\t\t\t\t__typename\n\t\t\t\t\t\t\t... on SystemArrangementConfig {\n\t\t\t\t\t\t\t\tvariant\n\t\t\t\t\t\t\t\tlinks\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}\n\t\t\t\t\t\tvisible\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.TopNavigationDocument,
    "\n\tquery BookClubNavigationItem {\n\t\tbookClubs {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t\temoji\n\t\t}\n\t}\n": types.BookClubNavigationItemDocument,
    "\n\tquery LibraryNavigationItem {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\temoji\n\t\t\t}\n\t\t}\n\t}\n": types.LibraryNavigationItemDocument,
    "\n\tquery SmartListNavigationItem {\n\t\tsmartLists {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": types.SmartListNavigationItemDocument,
    "\n\tquery EpubJsReader($id: ID!) {\n\t\tepubById(id: $id) {\n\t\t\tmediaId\n\t\t\trootBase\n\t\t\trootFile\n\t\t\textraCss\n\t\t\ttoc\n\t\t\tresources\n\t\t\tmetadata\n\t\t\tspine {\n\t\t\t\tid\n\t\t\t\tidref\n\t\t\t\tproperties\n\t\t\t\tlinear\n\t\t\t}\n\t\t\tbookmarks {\n\t\t\t\tid\n\t\t\t\tuserId\n\t\t\t\tepubcfi\n\t\t\t\tmediaId\n\t\t\t\tcreatedAt\n\t\t\t}\n\t\t\tmedia {\n\t\t\t\tid\n\t\t\t\tresolvedName\n\t\t\t\tpages\n\t\t\t\textension\n\t\t\t\treadProgress {\n\t\t\t\t\tpercentageCompleted\n\t\t\t\t\tepubcfi\n\t\t\t\t\tpage\n\t\t\t\t\telapsedSeconds\n\t\t\t\t}\n\t\t\t\tlibraryConfig {\n\t\t\t\t\tdefaultReadingImageScaleFit\n\t\t\t\t\tdefaultReadingMode\n\t\t\t\t\tdefaultReadingDir\n\t\t\t\t}\n\t\t\t\tnextInSeries(pagination: { cursor: { limit: 1 } }) {\n\t\t\t\t\tnodes {\n\t\t\t\t\t\tid\n\t\t\t\t\t\tname: resolvedName\n\t\t\t\t\t\tthumbnail {\n\t\t\t\t\t\t\turl\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.EpubJsReaderDocument,
    "\n\tmutation CreateBookmark($input: BookmarkInput!) {\n\t\tcreateBookmark(input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n": types.CreateBookmarkDocument,
    "\n\tmutation DeleteBookmarkByEpubcfi($epubcfi: String!) {\n\t\tdeleteBookmarkByEpubcfi(epubcfi: $epubcfi) {\n\t\t\t__typename\n\t\t}\n\t}\n": types.DeleteBookmarkByEpubcfiDocument,
    "\n\tquery SeriesBooksAlphabet($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tmediaAlphabet\n\t\t}\n\t}\n": types.SeriesBooksAlphabetDocument,
    "\n\tfragment SeriesMetadataEditor on SeriesMetadata {\n\t\tageRating\n\t\tbooktype\n\t\tcharacters\n\t\tcollects {\n\t\t\tseries\n\t\t\tcomicid\n\t\t\tissueid\n\t\t\tissues\n\t\t}\n\t\tcomicImage\n\t\tcomicid\n\t\tdescriptionFormatted\n\t\tgenres\n\t\timprint\n\t\tlinks\n\t\tmetaType\n\t\tpublicationRun\n\t\tpublisher\n\t\tstatus\n\t\tsummary\n\t\ttitle\n\t\ttotalIssues\n\t\tvolume\n\t\twriters\n\t\tyear\n\t\tlockedFields\n\t}\n": types.SeriesMetadataEditorFragmentDoc,
    "\n\tmutation UpdateSeriesMetadata($id: ID!, $input: SeriesMetadataInput!) {\n\t\tupdateSeriesMetadata(id: $id, input: $input) {\n\t\t\tmetadata {\n\t\t\t\t...SeriesMetadataEditor\n\t\t\t}\n\t\t}\n\t}\n": types.UpdateSeriesMetadataDocument,
    "\n\tmutation SeriesEditorSetLockedFields($seriesId: ID!, $lockedFields: [MetadataField!]!) {\n\t\tsetSeriesLockedFields(seriesId: $seriesId, lockedFields: $lockedFields) {\n\t\t\tid\n\t\t}\n\t}\n": types.SeriesEditorSetLockedFieldsDocument,
    "\n\tsubscription UseCoreEvent {\n\t\treadEvents {\n\t\t\t__typename\n\t\t\t... on CreatedManySeries {\n\t\t\t\tcount\n\t\t\t\tlibraryId\n\t\t\t}\n\t\t\t... on CreatedMedia {\n\t\t\t\tid\n\t\t\t\tseriesId\n\t\t\t}\n\t\t\t... on CreatedOrUpdatedManyMedia {\n\t\t\t\tcount\n\t\t\t\tseriesId\n\t\t\t}\n\t\t\t... on DiscoveredMissingLibrary {\n\t\t\t\tid\n\t\t\t}\n\t\t\t... on JobStarted {\n\t\t\t\tid\n\t\t\t}\n\t\t\t... on JobUpdate {\n\t\t\t\t__typename\n\t\t\t\tid\n\t\t\t\tstatus\n\t\t\t\tmessage\n\t\t\t\tcompletedTasks\n\t\t\t\tremainingTasks\n\t\t\t\tcompletedSubtasks\n\t\t\t\ttotalSubtasks\n\t\t\t\tsubtitle\n\t\t\t}\n\t\t\t... on JobOutput {\n\t\t\t\tid\n\t\t\t\toutput {\n\t\t\t\t\t__typename\n\t\t\t\t\t... on LibraryScanOutput {\n\t\t\t\t\t\tcreatedMedia\n\t\t\t\t\t\tcreatedSeries\n\t\t\t\t\t\tupdatedMedia\n\t\t\t\t\t\tupdatedSeries\n\t\t\t\t\t}\n\t\t\t\t\t... on SeriesScanOutput {\n\t\t\t\t\t\tcreatedMedia\n\t\t\t\t\t\tupdatedMedia\n\t\t\t\t\t}\n\t\t\t\t\t... on OrganizeLooseFilesOutput {\n\t\t\t\t\t\tmoved\n\t\t\t\t\t\tproposedMoves\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.UseCoreEventDocument,
    "\n\tmutation UsePreferences($input: UpdateUserPreferencesInput!) {\n\t\tupdateViewerPreferences(input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n": types.UsePreferencesDocument,
    "\n\tmutation UpdateReadProgress($id: ID!, $input: MediaProgressInput!) {\n\t\tupdateMediaProgress(id: $id, input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n": types.UpdateReadProgressDocument,
    "\n\tmutation BookActionMenuComplete($id: ID!) {\n\t\tfinishMediaProgress(id: $id)\n\t}\n": types.BookActionMenuCompleteDocument,
    "\n\tmutation BookActionMenuDeleteSession($id: ID!) {\n\t\tclearMediaProgress(id: $id)\n\t}\n": types.BookActionMenuDeleteSessionDocument,
    "\n\tmutation BookActionMenuDeleteHistory($id: ID!) {\n\t\tdeleteMediaReadingHistory(id: $id)\n\t}\n": types.BookActionMenuDeleteHistoryDocument,
    "\n\tfragment BookFileInformation on Media {\n\t\tid\n\t\tsize\n\t\textension\n\t\thash\n\t\trelativeLibraryPath\n\t}\n": types.BookFileInformationFragmentDoc,
    "\n\tquery BookLibrarySeriesLinks($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tlibrary {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t}\n\t}\n": types.BookLibrarySeriesLinksDocument,
    "\n\tfragment BookMetadata on Media {\n\t\tmetadata {\n\t\t\tageRating\n\t\t\tcharacters\n\t\t\tcolorists\n\t\t\tcoverArtists\n\t\t\teditors\n\t\t\tgenres\n\t\t\tinkers\n\t\t\tletterers\n\t\t\tlinks\n\t\t\tpencillers\n\t\t\tpublisher\n\t\t\tteams\n\t\t\twriters\n\t\t\tyear\n\t\t\tmonth\n\t\t\tday\n\t\t\tvolume\n\t\t\tnumber\n\t\t}\n\t}\n": types.BookMetadataFragmentDoc,
    "\n\tquery BooksAfterCurrentQuery($id: ID!, $pagination: Pagination) {\n\t\tmediaById(id: $id) {\n\t\t\tnextInSeries(pagination: $pagination) {\n\t\t\t\tnodes {\n\t\t\t\t\tid\n\t\t\t\t\t...BookCard\n\t\t\t\t}\n\t\t\t\tpageInfo {\n\t\t\t\t\t__typename\n\t\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\t\tcurrentCursor\n\t\t\t\t\t\tnextCursor\n\t\t\t\t\t\tlimit\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.BooksAfterCurrentQueryDocument,
    "\n\tquery BooksAlphabet {\n\t\tmediaAlphabet\n\t}\n": types.BooksAlphabetDocument,
    "\n\tquery EmailBookDropdownDevice {\n\t\temailDevices {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": types.EmailBookDropdownDeviceDocument,
    "\n\tmutation SendEmailAttachment($id: ID!, $sendTo: [EmailerSendTo!]!) {\n\t\tsendAttachmentEmail(input: { mediaIds: [$id], sendTo: $sendTo }) {\n\t\t\tsentCount\n\t\t\terrors\n\t\t}\n\t}\n": types.SendEmailAttachmentDocument,
    "\n\tquery BookReaderScene($id: ID!) {\n\t\tmediaById(id: $id) {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tpages\n\t\t\textension\n\t\t\treadProgress {\n\t\t\t\tpercentageCompleted\n\t\t\t\tepubcfi\n\t\t\t\tpage\n\t\t\t\telapsedSeconds\n\t\t\t}\n\t\t\tlibraryConfig {\n\t\t\t\tdefaultReadingImageScaleFit\n\t\t\t\tdefaultReadingMode\n\t\t\t\tdefaultReadingDir\n\t\t\t}\n\t\t\tanalysisData {\n\t\t\t\tdimensions {\n\t\t\t\t\theight\n\t\t\t\t\twidth\n\t\t\t\t}\n\t\t\t}\n\t\t\tnextInSeries(pagination: { cursor: { limit: 1 } }) {\n\t\t\t\tnodes {\n\t\t\t\t\tid\n\t\t\t\t\tname: resolvedName\n\t\t\t\t\tthumbnail {\n\t\t\t\t\t\turl\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.BookReaderSceneDocument,
    "\n\tquery BookManagementScene($id: ID!) {\n\t\tmediaById(id: $id) {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tlibrary {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tseries {\n\t\t\t\tid\n\t\t\t\tresolvedName\n\t\t\t}\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\t...BookThumbnailSelector\n\t\t}\n\t}\n": types.BookManagementSceneDocument,
    "\n\tmutation BookManagementSceneAnalyze($id: ID!) {\n\t\tanalyzeMedia(id: $id)\n\t}\n": types.BookManagementSceneAnalyzeDocument,
    "\n\tmutation BookTagEditorSetTags($id: ID!, $tags: [String!]!) {\n\t\tsetMediaTags(id: $id, tags: $tags) {\n\t\t\tid\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t}\n\t}\n": types.BookTagEditorSetTagsDocument,
    "\n\tfragment BookThumbnailSelector on Media {\n\t\tid\n\t\tthumbnail {\n\t\t\turl\n\t\t}\n\t\tpages\n\t}\n": types.BookThumbnailSelectorFragmentDoc,
    "\n\tmutation BookThumbnailSelectorUpdate($id: ID!, $input: PageBasedThumbnailInput!) {\n\t\tupdateMediaThumbnail(id: $id, input: $input) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": types.BookThumbnailSelectorUpdateDocument,
    "\n\tmutation BookThumbnailSelectorUpload($id: ID!, $file: Upload!) {\n\t\tuploadMediaThumbnail(id: $id, file: $file) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": types.BookThumbnailSelectorUploadDocument,
    "\n\tquery BookClubLayout($slug: String!) {\n\t\tbookClubBySlug(slug: $slug) {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t\tdescription\n\t\t\tisPrivate\n\t\t\troleSpec\n\t\t\tcreator {\n\t\t\t\tid\n\t\t\t\tdisplayName\n\t\t\t\tavatarUrl\n\t\t\t}\n\t\t\tmembersCount\n\t\t\tmembership {\n\t\t\t\trole\n\t\t\t\tavatarUrl\n\t\t\t\tisCreator\n\t\t\t}\n\t\t\tcurrentBook {\n\t\t\t\tid\n\t\t\t\ttitle\n\t\t\t\tauthor\n\t\t\t\timageUrl\n\t\t\t\tentity {\n\t\t\t\t\tid\n\t\t\t\t\tthumbnail {\n\t\t\t\t\t\turl\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\t...BookClubBookItem\n\t\t\t}\n\t\t\tcreatedAt\n\t\t}\n\t}\n": types.BookClubLayoutDocument,
    "\n\tmutation UpdateBookClub($id: ID!, $input: UpdateBookClubInput!) {\n\t\tupdateBookClub(id: $id, input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t\temoji\n\t\t\tisPrivate\n\t\t\troleSpec\n\t\t\tdescription\n\t\t}\n\t}\n": types.UpdateBookClubDocument,
    "\n\tquery UserBookClubsScene {\n\t\tbookClubs(all: false) {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t\tdescription\n\t\t\tmembersCount\n\t\t\tcurrentBook {\n\t\t\t\tid\n\t\t\t}\n\t\t}\n\t}\n": types.UserBookClubsSceneDocument,
    "\n\tquery CreateBookClubForm {\n\t\tbookClubs {\n\t\t\tname\n\t\t\tslug\n\t\t}\n\t}\n": types.CreateBookClubFormDocument,
    "\n\tmutation CreateBookClubScene($input: CreateBookClubInput!) {\n\t\tcreateBookClub(input: $input) {\n\t\t\tid\n\t\t\tslug\n\t\t}\n\t}\n": types.CreateBookClubSceneDocument,
    "\n\tquery BookClubBasicSettingsScene {\n\t\tbookClubs(all: true) {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t}\n\t}\n": types.BookClubBasicSettingsSceneDocument,
    "\n\tquery BookClubMembersTable($id: ID!) {\n\t\tbookClubById(id: $id) {\n\t\t\tid\n\t\t\tmembers {\n\t\t\t\tid\n\t\t\t\tavatarUrl\n\t\t\t\tisCreator\n\t\t\t\tdisplayName\n\t\t\t\trole\n\t\t\t\tuserId\n\t\t\t}\n\t\t}\n\t}\n": types.BookClubMembersTableDocument,
    "\n\tmutation RemoveBookClubMember($bookClubId: ID!, $memberId: ID!) {\n\t\tremoveBookClubMember(bookClubId: $bookClubId, memberId: $memberId) {\n\t\t\tid\n\t\t}\n\t}\n": types.RemoveBookClubMemberDocument,
    "\n\tquery BookSearchScene(\n\t\t$filter: MediaFilterInput!\n\t\t$orderBy: [MediaOrderBy!]!\n\t\t$pagination: Pagination!\n\t) {\n\t\tmedia(filter: $filter, orderBy: $orderBy, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...BookCard\n\t\t\t\t...BookMetadata\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.BookSearchSceneDocument,
    "\n\tquery CreateLibrarySceneExistingLibraries {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\tpath\n\t\t\t}\n\t\t}\n\t}\n": types.CreateLibrarySceneExistingLibrariesDocument,
    "\n\tmutation CreateLibrarySceneCreateLibrary($input: CreateOrUpdateLibraryInput!) {\n\t\tcreateLibrary(input: $input) {\n\t\t\tid\n\t\t}\n\t}\n": types.CreateLibrarySceneCreateLibraryDocument,
    "\n\tquery CreateSmartListForm {\n\t\tsmartLists(input: { mine: true }) {\n\t\t\tname\n\t\t}\n\t}\n": types.CreateSmartListFormDocument,
    "\n\tmutation CreateSmartListScene($input: SaveSmartListInput!) {\n\t\tcreateSmartList(input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": types.CreateSmartListSceneDocument,
    "\n\tfragment ContinueReadingBook on Media {\n\t\tid\n\t\tresolvedName\n\t\tpages\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t}\n\t\treadProgress {\n\t\t\tpercentageCompleted\n\t\t\tepubcfi\n\t\t\tpage\n\t\t\tupdatedAt\n\t\t}\n\t}\n": types.ContinueReadingBookFragmentDoc,
    "\n\tquery ContinueReadingMedia($pagination: Pagination!) {\n\t\tkeepReading(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...ContinueReadingBook\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.ContinueReadingMediaDocument,
    "\n\tquery HomeSceneQuery {\n\t\tnumberOfLibraries\n\t}\n": types.HomeSceneQueryDocument,
    "\n\tfragment OnDeckBook on Media {\n\t\tid\n\t\tmetadata {\n\t\t\tnumber\n\t\t}\n\t\tresolvedName\n\t\tseriesPosition\n\t\tseries {\n\t\t\tmediaCount\n\t\t\tmetadata {\n\t\t\t\ttotalIssues\n\t\t\t}\n\t\t}\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t}\n\t}\n": types.OnDeckBookFragmentDoc,
    "\n\tquery OnDeckBooksWeb($pagination: Pagination!) {\n\t\tonDeck(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...OnDeckBook\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.OnDeckBooksWebDocument,
    "\n\tfragment RecentlyAddedBook on Media {\n\t\tid\n\t\tresolvedName\n\t\tcreatedAt\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t}\n\t}\n": types.RecentlyAddedBookFragmentDoc,
    "\n\tquery RecentlyAddedMedia($pagination: Pagination!) {\n\t\trecentlyAddedMedia(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...RecentlyAddedBook\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.RecentlyAddedMediaDocument,
    "\n\tquery RecentlyAddedSeries($pagination: Pagination!) {\n\t\trecentlyAddedSeries(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tresolvedName\n\t\t\t\tmediaCount\n\t\t\t\tpercentageCompleted\n\t\t\t\tstatus\n\t\t\t\tcreatedAt\n\t\t\t\tmedia(take: 2, skip: 1) {\n\t\t\t\t\tid\n\t\t\t\t\tresolvedName\n\t\t\t\t\tthumbnail {\n\t\t\t\t\t\turl\n\t\t\t\t\t\tmetadata {\n\t\t\t\t\t\t\taverageColor\n\t\t\t\t\t\t\tcolors {\n\t\t\t\t\t\t\t\tcolor\n\t\t\t\t\t\t\t\tpercentage\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\tthumbhash\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\tthumbnail {\n\t\t\t\t\turl\n\t\t\t\t\tmetadata {\n\t\t\t\t\t\taverageColor\n\t\t\t\t\t\tcolors {\n\t\t\t\t\t\t\tcolor\n\t\t\t\t\t\t\tpercentage\n\t\t\t\t\t\t}\n\t\t\t\t\t\tthumbhash\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.RecentlyAddedSeriesDocument,
    "\n\tquery LibraryLayout($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t\tdescription\n\t\t\tpath\n\t\t\tstats {\n\t\t\t\tseriesCount\n\t\t\t\tbookCount\n\t\t\t\tcompletedBooks\n\t\t\t\tinProgressBooks\n\t\t\t\ttotalBytes\n\t\t\t\ttotalReadingTimeSeconds\n\t\t\t}\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t\tmetadata {\n\t\t\t\t\taverageColor\n\t\t\t\t\tthumbhash\n\t\t\t\t\tcolors {\n\t\t\t\t\t\tcolor\n\t\t\t\t\t\tpercentage\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tconfig {\n\t\t\t\tdefaultLibraryViewMode\n\t\t\t\thideSeriesView\n\t\t\t}\n\t\t\t...LibrarySettingsConfig\n\t\t}\n\t}\n": types.LibraryLayoutDocument,
    "\n\tmutation VisitLibrary($id: ID!) {\n\t\tvisitLibrary(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n": types.VisitLibraryDocument,
    "\n\tquery LibraryBooksScene(\n\t\t$filter: MediaFilterInput!\n\t\t$orderBy: [MediaOrderBy!]!\n\t\t$pagination: Pagination!\n\t) {\n\t\tmedia(filter: $filter, orderBy: $orderBy, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...BookCard\n\t\t\t\t...BookMetadata\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.LibraryBooksSceneDocument,
    "\n\tquery LibrarySeries(\n\t\t$filter: SeriesFilterInput!\n\t\t$orderBy: [SeriesOrderBy!]!\n\t\t$pagination: Pagination!\n\t) {\n\t\tseries(filter: $filter, orderBy: $orderBy, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tresolvedName\n\t\t\t\tmediaCount\n\t\t\t\tpercentageCompleted\n\t\t\t\tstatus\n\t\t\t\t# We fetch 2 and skip 1 because the first thumbnail _might_ be the same as the series thumbnail.\n\t\t\t\t# See https://github.com/stumpapp/stump/issues/899\n\t\t\t\tmedia(take: 2, skip: 1) {\n\t\t\t\t\tid\n\t\t\t\t\tthumbnail {\n\t\t\t\t\t\turl\n\t\t\t\t\t\tmetadata {\n\t\t\t\t\t\t\taverageColor\n\t\t\t\t\t\t\tcolors {\n\t\t\t\t\t\t\t\tcolor\n\t\t\t\t\t\t\t\tpercentage\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\tthumbhash\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\tthumbnail {\n\t\t\t\t\turl\n\t\t\t\t\tmetadata {\n\t\t\t\t\t\taverageColor\n\t\t\t\t\t\tcolors {\n\t\t\t\t\t\t\tcolor\n\t\t\t\t\t\t\tpercentage\n\t\t\t\t\t\t}\n\t\t\t\t\t\tthumbhash\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\ttotalPages\n\t\t\t\t\tcurrentPage\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.LibrarySeriesDocument,
    "\n\tquery LibrarySeriesGrid($id: String!, $pagination: Pagination) {\n\t\tseries(filter: { libraryId: { eq: $id } }, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tthumbnail {\n\t\t\t\t\turl\n\t\t\t\t}\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.LibrarySeriesGridDocument,
    "\n\tfragment LibrarySettingsConfig on Library {\n\t\tconfig {\n\t\t\tid\n\t\t\tconvertRarToZip\n\t\t\thardDeleteConversions\n\t\t\tdefaultReadingDir\n\t\t\tdefaultReadingMode\n\t\t\tdefaultReadingImageScaleFit\n\t\t\tdefaultLibraryViewMode\n\t\t\thideSeriesView\n\t\t\tskipBookOverview\n\t\t\tgenerateFileHashes\n\t\t\tgenerateKoreaderHashes\n\t\t\tprocessMetadata\n\t\t\twriteComicinfo\n\t\t\twatch\n\t\t\tautoOrganizeLooseFiles\n\t\t\tlibraryPattern\n\t\t\tlibraryType\n\t\t\tthumbnailConfig {\n\t\t\t\t__typename\n\t\t\t\tresizeMethod {\n\t\t\t\t\t__typename\n\t\t\t\t\t... on ScaleEvenlyByFactor {\n\t\t\t\t\t\tfactor\n\t\t\t\t\t}\n\t\t\t\t\t... on ExactDimensionResize {\n\t\t\t\t\t\twidth\n\t\t\t\t\t\theight\n\t\t\t\t\t}\n\t\t\t\t\t... on ScaledDimensionResize {\n\t\t\t\t\t\tdimension\n\t\t\t\t\t\tsize\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\tformat\n\t\t\t\tquality\n\t\t\t\tpage\n\t\t\t}\n\t\t\tprocessThumbnailColorsEvenWithoutConfig\n\t\t\tignoreRules\n\t\t}\n\t}\n": types.LibrarySettingsConfigFragmentDoc,
    "\n\tmutation LibrarySettingsRouterEditLibraryMutation($id: ID!, $input: CreateOrUpdateLibraryInput!) {\n\t\tupdateLibrary(id: $id, input: $input) {\n\t\t\tid\n\t\t}\n\t}\n": types.LibrarySettingsRouterEditLibraryMutationDocument,
    "\n\tmutation LibrarySettingsRouterScanLibraryMutation($id: ID!, $options: JSON) {\n\t\tscanLibrary(id: $id, options: $options)\n\t}\n": types.LibrarySettingsRouterScanLibraryMutationDocument,
    "\n\tquery BasicSettingsSceneExistingLibraries {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\tpath\n\t\t\t}\n\t\t}\n\t}\n": types.BasicSettingsSceneExistingLibrariesDocument,
    "\n\tquery LibraryExclusionsUsersQuery {\n\t\tusers(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n": types.LibraryExclusionsUsersQueryDocument,
    "\n\tquery LibraryExclusionsQuery($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\texcludedUsers {\n\t\t\t\tid\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n": types.LibraryExclusionsQueryDocument,
    "\n\tmutation UpdateLibraryExclusions($id: ID!, $userIds: [String!]!) {\n\t\tupdateLibraryExcludedUsers(id: $id, userIds: $userIds) {\n\t\t\tid\n\t\t\texcludedUsers {\n\t\t\t\tid\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n": types.UpdateLibraryExclusionsDocument,
    "\n\tmutation CleanLibrary($id: ID!) {\n\t\tcleanLibrary(id: $id) {\n\t\t\tdeletedMediaCount\n\t\t\tdeletedSeriesCount\n\t\t\tisEmpty\n\t\t}\n\t}\n": types.CleanLibraryDocument,
    "\n\tquery LibraryMissingEntities($libraryId: ID!, $pagination: Pagination!) {\n\t\tlibraryMissingEntities(libraryId: $libraryId, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tpath\n\t\t\t\ttype\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\ttotalPages\n\t\t\t\t\tcurrentPage\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t\ttotalItems\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.LibraryMissingEntitiesDocument,
    "\n\tmutation AnalyzeLibraryMedia($id: ID!) {\n\t\tanalyzeLibrary(id: $id)\n\t}\n": types.AnalyzeLibraryMediaDocument,
    "\n\tquery InitFetchJobCheckProviders {\n\t\tmetadataProviderConfigs {\n\t\t\tid\n\t\t}\n\t}\n": types.InitFetchJobCheckProvidersDocument,
    "\n\tmutation InitFetchJob($id: ID!) {\n\t\tfetchLibraryMetadata(id: $id)\n\t}\n": types.InitFetchJobDocument,
    "\n\tmutation OrganizeLooseFilesPlan($libraryId: ID!) {\n\t\tplanOrganizeLooseFiles(libraryId: $libraryId)\n\t}\n": types.OrganizeLooseFilesPlanDocument,
    "\n\tmutation OrganizeLooseFilesApply($libraryId: ID!, $decisions: [OrganizeDecisionInput!]!) {\n\t\tapplyOrganizeLooseFiles(libraryId: $libraryId, decisions: $decisions)\n\t}\n": types.OrganizeLooseFilesApplyDocument,
    "\n\tquery OrganizePreview($libraryId: ID!) {\n\t\torganizePreview(libraryId: $libraryId) {\n\t\t\tproposedMoves {\n\t\t\t\tsrc\n\t\t\t\tdst\n\t\t\t\tcanonicalName\n\t\t\t\tyear\n\t\t\t\texternalId\n\t\t\t\tprovider\n\t\t\t\tconfidence\n\t\t\t\tbucket\n\t\t\t\texistingSeriesId\n\t\t\t}\n\t\t\tunmatched {\n\t\t\t\tsrc\n\t\t\t\tparsedSeries\n\t\t\t\treason\n\t\t\t}\n\t\t}\n\t}\n": types.OrganizePreviewDocument,
    "\n\tmutation ScanHistorySectionClearHistory($id: ID!) {\n\t\tclearScanHistory(id: $id)\n\t}\n": types.ScanHistorySectionClearHistoryDocument,
    "\n\tquery ScanHistoryTable($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tid\n\t\t\tscanHistory {\n\t\t\t\tid\n\t\t\t\tjobId\n\t\t\t\ttimestamp\n\t\t\t\toptions\n\t\t\t}\n\t\t}\n\t}\n": types.ScanHistoryTableDocument,
    "\n\tquery ScanRecordInspectorJobs($id: ID!, $loadLogs: Boolean!) {\n\t\tjobById(id: $id) {\n\t\t\tid\n\t\t\toutputData {\n\t\t\t\t__typename\n\t\t\t\t... on LibraryScanOutput {\n\t\t\t\t\ttotalFiles\n\t\t\t\t\ttotalDirectories\n\t\t\t\t\tignoredFiles\n\t\t\t\t\tskippedFiles\n\t\t\t\t\tignoredDirectories\n\t\t\t\t\tcreatedMedia\n\t\t\t\t\tupdatedMedia\n\t\t\t\t\tcreatedSeries\n\t\t\t\t\tupdatedSeries\n\t\t\t\t}\n\t\t\t}\n\t\t\tlogs @include(if: $loadLogs) {\n\t\t\t\tid\n\t\t\t}\n\t\t}\n\t}\n": types.ScanRecordInspectorJobsDocument,
    "\n\tmutation DeleteLibraryThumbnails($id: ID!) {\n\t\tdeleteLibraryThumbnails(id: $id)\n\t}\n": types.DeleteLibraryThumbnailsDocument,
    "\n\tmutation LibraryThumbnailSelectorUpdate($id: ID!, $input: UpdateThumbnailInput!) {\n\t\tupdateLibraryThumbnail(id: $id, input: $input) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": types.LibraryThumbnailSelectorUpdateDocument,
    "\n\tmutation LibraryThumbnailSelectorUpload($id: ID!, $file: Upload!) {\n\t\tuploadLibraryThumbnail(id: $id, file: $file) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": types.LibraryThumbnailSelectorUploadDocument,
    "\n\tmutation ProcessLibraryThumbnails($id: ID!, $forceRegenerate: Boolean!) {\n\t\tprocessLibraryThumbnails(id: $id, forceRegenerate: $forceRegenerate)\n\t}\n": types.ProcessLibraryThumbnailsDocument,
    "\n\tmutation RegenerateThumbnails($id: ID!, $forceRegenerate: Boolean!) {\n\t\tgenerateLibraryThumbnails(id: $id, forceRegenerate: $forceRegenerate)\n\t}\n": types.RegenerateThumbnailsDocument,
    "\n\tmutation SeriesActionComplete($id: ID!) {\n\t\tfinishSeriesProgress(id: $id)\n\t}\n": types.SeriesActionCompleteDocument,
    "\n\tquery SeriesLayout($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\tpath\n\t\t\tlibrary {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tresolvedName\n\t\t\tresolvedDescription\n\t\t\tstats {\n\t\t\t\tbookCount\n\t\t\t\tcompletedBooks\n\t\t\t\tinProgressBooks\n\t\t\t\ttotalBytes\n\t\t\t\ttotalReadingTimeSeconds\n\t\t\t}\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t\tmetadata {\n\t\t\t\t\taverageColor\n\t\t\t\t\tthumbhash\n\t\t\t\t\tcolors {\n\t\t\t\t\t\tcolor\n\t\t\t\t\t\tpercentage\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tcreatedAt\n\t\t\tupdatedAt\n\t\t}\n\t}\n": types.SeriesLayoutDocument,
    "\n\tquery SeriesLibrayLink($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": types.SeriesLibrayLinkDocument,
    "\n\tquery SeriesOverviewSheetExtas($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\tmetadata {\n\t\t\t\tpublisher\n\t\t\t\tyear\n\t\t\t\tsummary\n\t\t\t\tlinks\n\t\t\t}\n\t\t\tupNext(take: 10) {\n\t\t\t\tid\n\t\t\t\t...SimpleBookCard\n\t\t\t}\n\t\t}\n\t}\n": types.SeriesOverviewSheetExtasDocument,
    "\n\tquery SeriesBooksScene(\n\t\t$filter: MediaFilterInput!\n\t\t$orderBy: [MediaOrderBy!]!\n\t\t$pagination: Pagination!\n\t) {\n\t\tmedia(filter: $filter, orderBy: $orderBy, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...BookCard\n\t\t\t\t...BookMetadata\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.SeriesBooksSceneDocument,
    "\n\tquery SeriesBookGrid($id: String!, $pagination: Pagination) {\n\t\tmedia(filter: { seriesId: { eq: $id } }, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tthumbnail {\n\t\t\t\t\turl\n\t\t\t\t}\n\t\t\t\tpages\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.SeriesBookGridDocument,
    "\n\tquery SeriesSettingsScene($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\t...SeriesThumbnailSelector\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tmetadata {\n\t\t\t\t...SeriesMetadataEditor\n\t\t\t}\n\t\t}\n\t}\n": types.SeriesSettingsSceneDocument,
    "\n\tmutation SeriesSettingsSceneAnalyze($id: ID!) {\n\t\tanalyzeSeries(id: $id)\n\t}\n": types.SeriesSettingsSceneAnalyzeDocument,
    "\n\tmutation SeriesSettingsSceneResetMetadata($id: ID!, $impact: MetadataResetImpact!) {\n\t\tresetSeriesMetadata(id: $id, impact: $impact) {\n\t\t\tid\n\t\t}\n\t}\n": types.SeriesSettingsSceneResetMetadataDocument,
    "\n\tmutation SeriesTagEditorSetTags($id: ID!, $tags: [String!]!) {\n\t\tsetSeriesTags(id: $id, tags: $tags) {\n\t\t\tid\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t}\n\t}\n": types.SeriesTagEditorSetTagsDocument,
    "\n\tfragment SeriesThumbnailSelector on Series {\n\t\tid\n\t\tthumbnail {\n\t\t\turl\n\t\t}\n\t}\n": types.SeriesThumbnailSelectorFragmentDoc,
    "\n\tmutation SeriesThumbnailSelectorUpdate($id: ID!, $input: UpdateThumbnailInput!) {\n\t\tupdateSeriesThumbnail(id: $id, input: $input) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": types.SeriesThumbnailSelectorUpdateDocument,
    "\n\tmutation SeriesThumbnailSelectorUpload($id: ID!, $file: Upload!) {\n\t\tuploadSeriesThumbnail(id: $id, file: $file) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n": types.SeriesThumbnailSelectorUploadDocument,
    "\n\tquery APIKeyTable {\n\t\tapiKeys {\n\t\t\tid\n\t\t\tname\n\t\t\tpermissions {\n\t\t\t\t__typename\n\t\t\t\t... on UserPermissionStruct {\n\t\t\t\t\tvalue\n\t\t\t\t}\n\t\t\t}\n\t\t\tlastUsedAt\n\t\t\texpiresAt\n\t\t\tcreatedAt\n\t\t}\n\t}\n": types.ApiKeyTableDocument,
    "\n\tmutation CreateAPIKeyModal($input: ApikeyInput!) {\n\t\tcreateApiKey(input: $input) {\n\t\t\tapiKey {\n\t\t\t\tid\n\t\t\t}\n\t\t\tsecret\n\t\t}\n\t}\n": types.CreateApiKeyModalDocument,
    "\n\tmutation DeleteAPIKeyConfirmModal($id: Int!) {\n\t\tdeleteApiKey(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n": types.DeleteApiKeyConfirmModalDocument,
    "\n\tmutation UploadUserAvatar($file: Upload!) {\n\t\tuploadUserAvatar(upload: $file) {\n\t\t\tid\n\t\t\tavatarUrl\n\t\t}\n\t}\n": types.UploadUserAvatarDocument,
    "\n\tmutation DeleteUserAvatar {\n\t\tdeleteUserAvatar {\n\t\t\tid\n\t\t\tavatarUrl\n\t\t}\n\t}\n": types.DeleteUserAvatarDocument,
    "\n\tmutation UpdateUserProfileForm($input: UpdateUserInput!) {\n\t\tupdateViewer(input: $input) {\n\t\t\tid\n\t\t\tusername\n\t\t}\n\t}\n": types.UpdateUserProfileFormDocument,
    "\n\tquery NavigationArrangement {\n\t\tme {\n\t\t\tpreferences {\n\t\t\t\tnavigationArrangement {\n\t\t\t\t\tlocked\n\t\t\t\t\tsections {\n\t\t\t\t\t\t__typename\n\t\t\t\t\t\tconfig {\n\t\t\t\t\t\t\t__typename\n\t\t\t\t\t\t\t... on SystemArrangementConfig {\n\t\t\t\t\t\t\t\tvariant\n\t\t\t\t\t\t\t\tlinks\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}\n\t\t\t\t\t\tvisible\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.NavigationArrangementDocument,
    "\n\tmutation NavigationArrangementUpdate($input: NavigationArrangementInput!) {\n\t\tupdateNavigationArrangement(input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n": types.NavigationArrangementUpdateDocument,
    "\n\tmutation NavigationArrangementUpdateLockStatus($locked: Boolean!) {\n\t\tupdateNavigationArrangementLock(locked: $locked) {\n\t\t\t__typename\n\t\t}\n\t}\n": types.NavigationArrangementUpdateLockStatusDocument,
    "\n\tquery CreateEmailerSceneEmailers {\n\t\temailers {\n\t\t\tname\n\t\t}\n\t}\n": types.CreateEmailerSceneEmailersDocument,
    "\n\tmutation CreateEmailerSceneCreateEmailer($input: EmailerInput!) {\n\t\tcreateEmailer(input: $input) {\n\t\t\tid\n\t\t}\n\t}\n": types.CreateEmailerSceneCreateEmailerDocument,
    "\n\tquery EditEmailerScene($id: Int!) {\n\t\temailers {\n\t\t\tname\n\t\t}\n\t\temailerById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t\tisPrimary\n\t\t\tsmtpHost\n\t\t\tsmtpPort\n\t\t\tlastUsedAt\n\t\t\tmaxAttachmentSizeBytes\n\t\t\tsenderDisplayName\n\t\t\tsenderEmail\n\t\t\ttlsEnabled\n\t\t\tusername\n\t\t}\n\t}\n": types.EditEmailerSceneDocument,
    "\n\tmutation EditEmailerSceneEditEmailer($id: Int!, $input: EmailerInput!) {\n\t\tupdateEmailer(id: $id, input: $input) {\n\t\t\tid\n\t\t}\n\t}\n": types.EditEmailerSceneEditEmailerDocument,
    "\n\tmutation CreateOrUpdateDeviceModalCreateEmailDevice($input: EmailDeviceInput!) {\n\t\tcreateEmailDevice(input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": types.CreateOrUpdateDeviceModalCreateEmailDeviceDocument,
    "\n\tmutation CreateOrUpdateDeviceModalUpdateEmailDevice($id: Int!, $input: EmailDeviceInput!) {\n\t\tupdateEmailDevice(id: $id, input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t\tforbidden\n\t\t}\n\t}\n": types.CreateOrUpdateDeviceModalUpdateEmailDeviceDocument,
    "\n\tmutation DeleteDeviceConfirmationDeleteEmailDevice($id: Int!) {\n\t\tdeleteEmailDevice(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n": types.DeleteDeviceConfirmationDeleteEmailDeviceDocument,
    "\n\tquery EmailDevicesTable {\n\t\temailDevices {\n\t\t\tid\n\t\t\tname\n\t\t\temail\n\t\t\tforbidden\n\t\t}\n\t}\n": types.EmailDevicesTableDocument,
    "\n\tfragment EmailerListItem on Emailer {\n\t\tid\n\t\tname\n\t\tisPrimary\n\t\tsmtpHost\n\t\tsmtpPort\n\t\tlastUsedAt\n\t\tmaxAttachmentSizeBytes\n\t\tsenderDisplayName\n\t\tsenderEmail\n\t\ttlsEnabled\n\t\tusername\n\t}\n": types.EmailerListItemFragmentDoc,
    "\n\tmutation DeleteEmailer($emailerId: Int!) {\n\t\tdeleteEmailer(id: $emailerId) {\n\t\t\tid\n\t\t}\n\t}\n": types.DeleteEmailerDocument,
    "\n\tquery EmailerSendHistory($id: Int!, $fetchUser: Boolean!) {\n\t\temailerById(id: $id) {\n\t\t\tsendHistory {\n\t\t\t\tsentAt\n\t\t\t\trecipientEmail\n\t\t\t\tsentByUserId\n\t\t\t\tsentBy @include(if: $fetchUser) {\n\t\t\t\t\tid\n\t\t\t\t\tusername\n\t\t\t\t}\n\t\t\t\tattachmentMeta {\n\t\t\t\t\tfilename\n\t\t\t\t\tmediaId\n\t\t\t\t\tmedia {\n\t\t\t\t\t\tresolvedName\n\t\t\t\t\t}\n\t\t\t\t\tsize\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.EmailerSendHistoryDocument,
    "\n\tquery EmailersList {\n\t\temailers {\n\t\t\tid\n\t\t\t...EmailerListItem\n\t\t}\n\t}\n": types.EmailersListDocument,
    "\n\tmutation TestEmailer($config: EmailerClientConfig!, $recipient: String!) {\n\t\ttestEmailer(config: $config, recipient: $recipient)\n\t}\n": types.TestEmailerDocument,
    "\n\tquery ServerEmojisSection {\n\t\tcustomEmojis {\n\t\t\tid\n\t\t\tname\n\t\t\tisAnimated\n\t\t\turl\n\t\t}\n\t}\n": types.ServerEmojisSectionDocument,
    "\n\tmutation ServerEmojisSectionUploadEmoji($input: CreateCustomEmojiInput!, $upload: Upload!) {\n\t\tuploadCustomEmoji(input: $input, upload: $upload) {\n\t\t\tid\n\t\t\tname\n\t\t\tisAnimated\n\t\t\turl\n\t\t}\n\t}\n": types.ServerEmojisSectionUploadEmojiDocument,
    "\n\tmutation ServerEmojisSectionRenameEmoji($id: ID!, $input: UpdateCustomEmojiInput!) {\n\t\tupdateCustomEmoji(id: $id, input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t\tisAnimated\n\t\t\turl\n\t\t}\n\t}\n": types.ServerEmojisSectionRenameEmojiDocument,
    "\n\tmutation ServerEmojisSectionDeleteEmoji($id: ID!) {\n\t\tdeleteCustomEmoji(id: $id)\n\t}\n": types.ServerEmojisSectionDeleteEmojiDocument,
    "\n\tmutation ServerPublicURLUpdate($publicUrl: String!) {\n\t\tupdatePublicUrl(publicUrl: $publicUrl) {\n\t\t\tpublicUrl\n\t\t}\n\t}\n": types.ServerPublicUrlUpdateDocument,
    "\n\tquery ServerPublicURL {\n\t\tserverConfig {\n\t\t\tpublicUrl\n\t\t}\n\t}\n": types.ServerPublicUrlDocument,
    "\n\tquery ServerStats {\n\t\tnumberOfLibraries\n\t\tnumberOfSeries\n\t\tmediaCount\n\t\tmediaDiskUsage\n\t}\n": types.ServerStatsDocument,
    "\n\tmutation CreateScheduledJob($input: CreateScheduledJobInput!) {\n\t\tcreateScheduledJob(input: $input) {\n\t\t\t...ScheduledJobRow\n\t\t}\n\t}\n": types.CreateScheduledJobDocument,
    "\n\tmutation UpdateScheduledJob($id: Int!, $input: UpdateScheduledJobInput!) {\n\t\tupdateScheduledJob(id: $id, input: $input) {\n\t\t\t...ScheduledJobRow\n\t\t}\n\t}\n": types.UpdateScheduledJobDocument,
    "\n\tmutation DeleteJobHistoryConfirmation {\n\t\tdeleteJobHistory {\n\t\t\taffectedRows\n\t\t}\n\t}\n": types.DeleteJobHistoryConfirmationDocument,
    "\n\tmutation JobActionMenuCancelJob($id: ID!) {\n\t\tcancelJob(id: $id)\n\t}\n": types.JobActionMenuCancelJobDocument,
    "\n\tmutation JobActionMenuDeleteJob($id: ID!) {\n\t\tcancelJob(id: $id)\n\t}\n": types.JobActionMenuDeleteJobDocument,
    "\n\tmutation JobActionMenuDeleteLogs($id: ID!) {\n\t\tdeleteJobLogs(id: $id) {\n\t\t\taffectedRows\n\t\t}\n\t}\n": types.JobActionMenuDeleteLogsDocument,
    "\n\tfragment JobDataInspector on CoreJobOutput {\n\t\t__typename\n\t\t... on LibraryScanOutput {\n\t\t\ttotalFiles\n\t\t\ttotalDirectories\n\t\t\tignoredFiles\n\t\t\tskippedFiles\n\t\t\tignoredDirectories\n\t\t\tcreatedMedia\n\t\t\tupdatedMedia\n\t\t\tcreatedSeries\n\t\t\tupdatedSeries\n\t\t}\n\t\t... on SeriesScanOutput {\n\t\t\ttotalFiles\n\t\t\tignoredFiles\n\t\t\tskippedFiles\n\t\t\tcreatedMedia\n\t\t\tupdatedMedia\n\t\t}\n\t\t... on ThumbnailGenerationOutput {\n\t\t\tvisitedFiles\n\t\t\tskippedFiles\n\t\t\tgeneratedThumbnails\n\t\t\tremovedThumbnails\n\t\t}\n\t}\n": types.JobDataInspectorFragmentDoc,
    "\n\tquery ScheduledJobs {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\temoji\n\t\t\t}\n\t\t}\n\t\tscheduledJobs {\n\t\t\tid\n\t\t\tname\n\t\t\t...ScheduledJobRow\n\t\t}\n\t}\n": types.ScheduledJobsDocument,
    "\n\tmutation DeleteScheduledJob($id: Int!) {\n\t\tdeleteScheduledJob(id: $id)\n\t}\n": types.DeleteScheduledJobDocument,
    "\n\tquery JobTable($pagination: Pagination!) {\n\t\tjobs(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\tdescription\n\t\t\t\tstatus\n\t\t\t\tcreatedAt\n\t\t\t\tcompletedAt\n\t\t\t\tmsElapsed\n\t\t\t\toutputData {\n\t\t\t\t\t...JobDataInspector\n\t\t\t\t}\n\t\t\t\tlogCount\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.JobTableDocument,
    "\n\tfragment ScheduledJobRow on ScheduledJob {\n\t\tid\n\t\tname\n\t\tkind\n\t\tschedule\n\t\tconfig\n\t\tenabled\n\t\tcreatedAt\n\t\tlastRunAt\n\t}\n": types.ScheduledJobRowFragmentDoc,
    "\n\tsubscription LiveLogsFeed {\n\t\ttailLogFile\n\t}\n": types.LiveLogsFeedDocument,
    "\n\tmutation DeleteLogs {\n\t\tdeleteLogs {\n\t\t\tdeleted\n\t\t}\n\t}\n": types.DeleteLogsDocument,
    "\n\tquery PersistedLogs(\n\t\t$filter: LogFilterInput!\n\t\t$pagination: Pagination!\n\t\t$orderBy: [LogModelOrderBy!]!\n\t) {\n\t\tlogs(filter: $filter, pagination: $pagination, orderBy: $orderBy) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\ttimestamp\n\t\t\t\tlevel\n\t\t\t\tmessage\n\t\t\t\tjobId\n\t\t\t\tcontext\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\ttotalPages\n\t\t\t\t\tcurrentPage\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.PersistedLogsDocument,
    "\n\tmutation CreateProviderDialogCreateProvider($input: CreateMetadataProviderConfigInput!) {\n\t\tcreateMetadataProvider(input: $input) {\n\t\t\tid\n\t\t\tproviderType\n\t\t\tenabled\n\t\t}\n\t}\n": types.CreateProviderDialogCreateProviderDocument,
    "\n\tmutation EditProviderDialog($id: Int!, $input: PatchMetadataProviderConfigInput!) {\n\t\tupdateMetadataProvider(id: $id, input: $input) {\n\t\t\tid\n\t\t\t...ExistingProviderCard\n\t\t}\n\t}\n": types.EditProviderDialogDocument,
    "\n\tmutation DeleteProviderDialog($id: Int!) {\n\t\tdeleteMetadataProvider(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n": types.DeleteProviderDialogDocument,
    "\n\tfragment ExistingProviderCard on MetadataProviderConfigModel {\n\t\tid\n\t\tproviderType\n\t\tenabled\n\t\tapiTokenExpiresAt\n\t\tautoApplyConfig\n\t\tcreatedAt\n\t\tupdatedAt\n\t}\n": types.ExistingProviderCardFragmentDoc,
    "\n\tquery ProvidersSectionGetProviders {\n\t\tmetadataProviderConfigs {\n\t\t\tid\n\t\t\tproviderType\n\t\t\tposition\n\t\t\t...ExistingProviderCard\n\t\t}\n\t}\n": types.ProvidersSectionGetProvidersDocument,
    "\n\tmutation ProvidersSectionSetPreferred($id: Int!, $input: PatchMetadataProviderConfigInput!) {\n\t\tupdateMetadataProvider(id: $id, input: $input) {\n\t\t\tid\n\t\t\tposition\n\t\t}\n\t}\n": types.ProvidersSectionSetPreferredDocument,
    "\n\tmutation CreateTagModal($tags: [String!]!) {\n\t\tcreateTags(tags: $tags) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": types.CreateTagModalDocument,
    "\n\tmutation DeleteTagConfirmModal($tags: [String!]!) {\n\t\tdeleteTags(tags: $tags) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": types.DeleteTagConfirmModalDocument,
    "\n\tmutation RenameTagModal($id: Int!, $name: String!) {\n\t\trenameTag(id: $id, name: $name) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": types.RenameTagModalDocument,
    "\n\tquery TagTable {\n\t\ttags {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": types.TagTableDocument,
    "\n\tquery UserStats {\n\t\tuserCount\n\t\ttopReaders(take: 1) {\n\t\t\tid\n\t\t\tusername\n\t\t\tfinishedReadingSessionsCount\n\t\t}\n\t\tactiveReadingSessionCount\n\t\tfinishedReadingSessionCount\n\t}\n": types.UserStatsDocument,
    "\n\tmutation CreateOrUpdateUserFormUpdateUser($id: ID!, $input: UpdateUserInput!) {\n\t\tupdateUser(id: $id, input: $input) {\n\t\t\tid\n\t\t\tusername\n\t\t\tageRestriction {\n\t\t\t\tage\n\t\t\t\trestrictOnUnset\n\t\t\t}\n\t\t\tpermissions\n\t\t\tmaxSessionsAllowed\n\t\t}\n\t}\n": types.CreateOrUpdateUserFormUpdateUserDocument,
    "\n\tmutation CreateOrUpdateUserFormCreateUser($input: CreateUserInput!) {\n\t\tcreateUser(input: $input) {\n\t\t\tid\n\t\t}\n\t}\n": types.CreateOrUpdateUserFormCreateUserDocument,
    "\n\tquery CreateUserScene {\n\t\tusers(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n": types.CreateUserSceneDocument,
    "\n\tquery UpdateUserScene($id: ID!, $skip: Boolean!) {\n\t\tme {\n\t\t\tid\n\t\t}\n\t\tuserById(id: $id) @skip(if: $skip) {\n\t\t\tid\n\t\t\tavatarUrl\n\t\t\tusername\n\t\t\tageRestriction {\n\t\t\t\tage\n\t\t\t\trestrictOnUnset\n\t\t\t}\n\t\t\tpermissions\n\t\t\tmaxSessionsAllowed\n\t\t\tisServerOwner\n\t\t}\n\t\tusers(pagination: { none: { unpaginated: true } }) @skip(if: $skip) {\n\t\t\tnodes {\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n": types.UpdateUserSceneDocument,
    "\n\tmutation ClearLoginActivityConfirmation {\n\t\tdeleteLoginActivity\n\t}\n": types.ClearLoginActivityConfirmationDocument,
    "\n\tquery LoginActivityTable {\n\t\tloginActivity {\n\t\t\tid\n\t\t\tipAddress\n\t\t\tuserAgent\n\t\t\tauthenticationSuccessful\n\t\t\ttimestamp\n\t\t\tuser {\n\t\t\t\tid\n\t\t\t\tusername\n\t\t\t\tavatarUrl\n\t\t\t}\n\t\t}\n\t}\n": types.LoginActivityTableDocument,
    "\n\tmutation DeleteUser($id: ID!, $hardDelete: Boolean) {\n\t\tdeleteUser(id: $id, hardDelete: $hardDelete) {\n\t\t\tid\n\t\t}\n\t}\n": types.DeleteUserDocument,
    "\n\tmutation UserActionMenuLockUser($id: ID!, $lock: Boolean!) {\n\t\tupdateUserLockStatus(id: $id, lock: $lock) {\n\t\t\tid\n\t\t\tisLocked\n\t\t}\n\t}\n": types.UserActionMenuLockUserDocument,
    "\n\tmutation UserActionMenuDeleteUserSessions($id: ID!) {\n\t\tdeleteUserSessions(id: $id)\n\t}\n": types.UserActionMenuDeleteUserSessionsDocument,
    "\n\tquery UserTable($pagination: Pagination!) {\n\t\tusers(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tavatarUrl\n\t\t\t\tusername\n\t\t\t\tisServerOwner\n\t\t\t\tisLocked\n\t\t\t\tcreatedAt\n\t\t\t\tlastLogin\n\t\t\t\tloginSessionsCount\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\ttotalPages\n\t\t\t\t\tcurrentPage\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.UserTableDocument,
    "\n\tfragment SmartListCard on SmartList {\n\t\tid\n\t\tdescription\n\t\tfilters\n\t\tjoiner\n\t\tname\n\t}\n": types.SmartListCardFragmentDoc,
    "\n\tquery SmartListsWithSearch($input: SmartListsInput!) {\n\t\tsmartLists(input: $input) {\n\t\t\tid\n\t\t\tcreatorId\n\t\t\tdescription\n\t\t\tdefaultGrouping\n\t\t\tfilters\n\t\t\tjoiner\n\t\t\tname\n\t\t\tvisibility\n\t\t\t...SmartListCard\n\t\t}\n\t}\n": types.SmartListsWithSearchDocument,
    "\n\tquery SmartListById($id: ID!) {\n\t\tsmartListById(id: $id) {\n\t\t\tid\n\t\t\tcreatorId\n\t\t\tdescription\n\t\t\tdefaultGrouping\n\t\t\tfilters\n\t\t\tjoiner\n\t\t\tname\n\t\t\tvisibility\n\t\t\tviews {\n\t\t\t\tid\n\t\t\t\tlistId\n\t\t\t\tname\n\t\t\t\tbookColumns {\n\t\t\t\t\tid\n\t\t\t\t\tposition\n\t\t\t\t}\n\t\t\t\tbookSorting {\n\t\t\t\t\tid\n\t\t\t\t\tdesc\n\t\t\t\t}\n\t\t\t\tgroupColumns {\n\t\t\t\t\tid\n\t\t\t\t\tposition\n\t\t\t\t}\n\t\t\t\tgroupSorting {\n\t\t\t\t\tid\n\t\t\t\t\tdesc\n\t\t\t\t}\n\t\t\t\tsearch\n\t\t\t}\n\t\t}\n\t}\n": types.SmartListByIdDocument,
    "\n\tquery SmartListMeta($id: ID!) {\n\t\tsmartListMeta(id: $id) {\n\t\t\tmatchedBooks\n\t\t\tmatchedSeries\n\t\t\tmatchedLibraries\n\t\t}\n\t}\n": types.SmartListMetaDocument,
    "\n\tmutation UpdateSmartList($id: ID!, $input: SaveSmartListInput!) {\n\t\tupdateSmartList(id: $id, input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n": types.UpdateSmartListDocument,
    "\n\tquery SmartListItems($id: ID!) {\n\t\tsmartListItems(id: $id) {\n\t\t\t__typename\n\t\t\t... on SmartListGrouped {\n\t\t\t\titems {\n\t\t\t\t\tentity {\n\t\t\t\t\t\t__typename\n\t\t\t\t\t\t... on Series {\n\t\t\t\t\t\t\tid\n\t\t\t\t\t\t\tname\n\t\t\t\t\t\t}\n\t\t\t\t\t\t... on Library {\n\t\t\t\t\t\t\tid\n\t\t\t\t\t\t\tname\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t\tbooks {\n\t\t\t\t\t\t...BookCard\n\t\t\t\t\t\t...BookMetadata\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\t... on SmartListUngrouped {\n\t\t\t\tbooks {\n\t\t\t\t\t...BookCard\n\t\t\t\t\t...SmartListItemBookMetadata\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.SmartListItemsDocument,
    "\n\tfragment SmartListItemBookMetadata on Media {\n\t\tmetadata {\n\t\t\tageRating\n\t\t\tcharacters\n\t\t\tcolorists\n\t\t\tcoverArtists\n\t\t\teditors\n\t\t\tgenres\n\t\t\tinkers\n\t\t\tletterers\n\t\t\tlinks\n\t\t\tpencillers\n\t\t\tpublisher\n\t\t\tteams\n\t\t\twriters\n\t\t\tyear\n\t\t\tmonth\n\t\t\tday\n\t\t\tformat\n\t\t\tidentifierAmazon\n\t\t\tidentifierCalibre\n\t\t\tidentifierGoogle\n\t\t\tidentifierIsbn\n\t\t\tidentifierMobiAsin\n\t\t\tidentifierUuid\n\t\t\tlanguage\n\t\t\tnotes\n\t\t\tnumber\n\t\t\tpageCount\n\t\t\tseries\n\t\t\tseriesGroup\n\t\t\tstoryArc\n\t\t\tstoryArcNumber\n\t\t\ttitle\n\t\t\ttitleSort\n\t\t\tvolume\n\t\t}\n\t}\n": types.SmartListItemBookMetadataFragmentDoc,
    "\n\tmutation CreateSmartListView($input: SaveSmartListView!) {\n\t\tcreateSmartListView(input: $input) {\n\t\t\tid\n\t\t\tlistId\n\t\t\tname\n\t\t\tsearch\n\t\t\tenableMultiSort\n\t\t\tbookColumns {\n\t\t\t\tid\n\t\t\t\tposition\n\t\t\t}\n\t\t\tbookSorting {\n\t\t\t\tid\n\t\t\t\tdesc\n\t\t\t}\n\t\t\tgroupColumns {\n\t\t\t\tid\n\t\t\t\tposition\n\t\t\t}\n\t\t\tgroupSorting {\n\t\t\t\tid\n\t\t\t\tdesc\n\t\t\t}\n\t\t}\n\t}\n": types.CreateSmartListViewDocument,
    "\n\tmutation UpdateSmartListView($originalName: String!, $input: SaveSmartListView!) {\n\t\tupdateSmartListView(originalName: $originalName, input: $input) {\n\t\t\tid\n\t\t\tlistId\n\t\t\tname\n\t\t\tsearch\n\t\t\tenableMultiSort\n\t\t\tbookColumns {\n\t\t\t\tid\n\t\t\t\tposition\n\t\t\t}\n\t\t\tbookSorting {\n\t\t\t\tid\n\t\t\t\tdesc\n\t\t\t}\n\t\t\tgroupColumns {\n\t\t\t\tid\n\t\t\t\tposition\n\t\t\t}\n\t\t\tgroupSorting {\n\t\t\t\tid\n\t\t\t\tdesc\n\t\t\t}\n\t\t}\n\t}\n": types.UpdateSmartListViewDocument,
    "\n\tmutation DeleteSmartListView($id: ID!, $name: String!) {\n\t\tdeleteSmartListView(id: $id, name: $name) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n": types.DeleteSmartListViewDocument,
    "\n\tquery SmartListBasicSettingsScene {\n\t\tsmartLists(input: { mine: true }) {\n\t\t\tname\n\t\t}\n\t}\n": types.SmartListBasicSettingsSceneDocument,
    "\n\tmutation DeleteSmartList($id: ID!) {\n\t\tdeleteSmartList(id: $id) {\n\t\t\t__typename\n\t\t}\n\t}\n": types.DeleteSmartListDocument,
    "\n\tquery DirectoryListing($input: DirectoryListingInput!, $pagination: Pagination!) {\n\t\tlistDirectory(input: $input, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tparent\n\t\t\t\tfiles {\n\t\t\t\t\tname\n\t\t\t\t\tpath\n\t\t\t\t\tisDirectory\n\t\t\t\t\tmedia {\n\t\t\t\t\t\tid\n\t\t\t\t\t\tresolvedName\n\t\t\t\t\t\tthumbnail {\n\t\t\t\t\t\t\turl\n\t\t\t\t\t\t}\n\t\t\t\t\t\textension\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n": types.DirectoryListingDocument,
    "\n\tquery UploadConfig {\n\t\tuploadConfig {\n\t\t\tenabled\n\t\t\tmaxFileUploadSize\n\t\t}\n\t}\n": types.UploadConfigDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery TagSelectQuery {\n\t\ttags {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').TagSelectQueryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment BookCard on Media {\n\t\tid\n\t\tresolvedName\n\t\textension\n\t\tpages\n\t\tsize\n\t\tstatus\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t\theight\n\t\t\twidth\n\t\t}\n\t\treadProgress {\n\t\t\tpercentageCompleted\n\t\t\tepubcfi\n\t\t\tpage\n\t\t\tupdatedAt\n\t\t}\n\t\treadHistory {\n\t\t\t__typename\n\t\t\tcompletedAt\n\t\t}\n\t\tcreatedAt\n\t\tlibraryConfig {\n\t\t\tskipBookOverview\n\t\t}\n\t}\n"): typeof import('./graphql').BookCardFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BookSearchOverlay($pagination: Pagination, $filter: MediaFilterInput!) {\n\t\tmedia(pagination: $pagination, filter: $filter) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...BookCard\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').BookSearchOverlayDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment SimpleBookCard on Media {\n\t\tid\n\t\tresolvedName\n\t\tcreatedAt\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').SimpleBookCardFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment MediaMetadataEditor on MediaMetadata {\n\t\tageRating\n\t\tcharacters\n\t\tcolorists\n\t\tcoverArtists\n\t\tday\n\t\teditors\n\t\tformat\n\t\tidentifierAmazon\n\t\tidentifierCalibre\n\t\tidentifierGoogle\n\t\tidentifierIsbn\n\t\tidentifierMobiAsin\n\t\tidentifierUuid\n\t\tgenres\n\t\tinkers\n\t\tlanguage\n\t\tletterers\n\t\tlinks\n\t\tmonth\n\t\tnotes\n\t\tnumber\n\t\tpageCount\n\t\tpencillers\n\t\tpublisher\n\t\tseries\n\t\tseriesGroup\n\t\tstoryArc\n\t\tstoryArcNumber\n\t\tsummary\n\t\tteams\n\t\ttitle\n\t\ttitleSort\n\t\tvolume\n\t\twriters\n\t\tyear\n\t\tlockedFields\n\t}\n"): typeof import('./graphql').MediaMetadataEditorFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UpdateMediaMetadata($id: ID!, $input: MediaMetadataInput!) {\n\t\tupdateMediaMetadata(id: $id, input: $input) {\n\t\t\tmetadata {\n\t\t\t\t...MediaMetadataEditor\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').UpdateMediaMetadataDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation MediaEditorSetLockedFields($mediaId: ID!, $lockedFields: [MetadataField!]!) {\n\t\tsetMediaLockedFields(mediaId: $mediaId, lockedFields: $lockedFields) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').MediaEditorSetLockedFieldsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BookOverviewScene($id: ID!) {\n\t\tmediaById(id: $id) {\n\t\t\tid\n\t\t\t...BookCard\n\t\t\t...BookFileInformation\n\t\t\tresolvedName\n\t\t\textension\n\t\t\tseriesId\n\t\t\tpages\n\t\t\tsize\n\t\t\tmetadata {\n\t\t\t\tlinks\n\t\t\t\tsummary\n\t\t\t\tageRating\n\t\t\t\tgenres\n\t\t\t\tlanguage\n\t\t\t\tpublisher\n\t\t\t\twriters\n\t\t\t\tyear\n\t\t\t\t...MediaMetadataEditor\n\t\t\t}\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\treadHistory {\n\t\t\t\tcompletedAt\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').BookOverviewSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteBookClubConfirmation($id: ID!) {\n\t\tdeleteBookClub(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').DeleteBookClubConfirmationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment BookClubBookItem on BookClubBook {\n\t\tid\n\t\ttitle\n\t\tauthor\n\t\timageUrl\n\t\turl\n\t\tentity {\n\t\t\t__typename\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tmetadata {\n\t\t\t\twriters\n\t\t\t}\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t\tcompletedAt\n\t\taddedAt\n\t}\n"): typeof import('./graphql').BookClubBookItemFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BookClubBooksScene($id: ID!) {\n\t\tbookClubById(id: $id) {\n\t\t\tid\n\t\t\tpreviousBooks {\n\t\t\t\tid\n\t\t\t\t...BookClubBookItem\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').BookClubBooksSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery MediaAtPath($path: String!) {\n\t\tmediaByPath(path: $path) {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').MediaAtPathDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UploadLibraryBooks($input: UploadBooksInput!) {\n\t\tuploadBooks(input: $input)\n\t}\n"): typeof import('./graphql').UploadLibraryBooksDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UploadLibrarySeries($input: UploadSeriesInput!) {\n\t\tuploadSeries(input: $input)\n\t}\n"): typeof import('./graphql').UploadLibrarySeriesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery MediaFilterForm($seriesId: ID) {\n\t\tmediaMetadataOverview(seriesId: $seriesId) {\n\t\t\tgenres\n\t\t\twriters\n\t\t\tpencillers\n\t\t\tcolorists\n\t\t\tletterers\n\t\t\tinkers\n\t\t\tpublishers\n\t\t\teditors\n\t\t\tcharacters\n\t\t}\n\t}\n"): typeof import('./graphql').MediaFilterFormDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteLibrary($id: ID!) {\n\t\tdeleteLibrary(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').DeleteLibraryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery LastVisitedLibrary {\n\t\tlastVisitedLibrary {\n\t\t\tid\n\t\t\tname\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').LastVisitedLibraryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery LibraryBooksAlphabet($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tmediaAlphabet\n\t\t}\n\t}\n"): typeof import('./graphql').LibraryBooksAlphabetDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery LibrarySeriesAlphabet($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tseriesAlphabet\n\t\t}\n\t}\n"): typeof import('./graphql').LibrarySeriesAlphabetDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment PendingMatchRecord on MetadataFetchRecord {\n\t\tid\n\t\tstatus\n\t\tmediaId\n\t\tseriesId\n\t\tmatchCandidates {\n\t\t\tprovider\n\t\t\texternalId\n\t\t\tmetadata {\n\t\t\t\t__typename\n\t\t\t\t... on ExternalMediaMetadata {\n\t\t\t\t\ttitle\n\t\t\t\t\tseriesName\n\t\t\t\t\tseriesExternalId\n\t\t\t\t\tsummary\n\t\t\t\t\tpageCount\n\t\t\t\t\tnumber\n\t\t\t\t\tday\n\t\t\t\t\tmonth\n\t\t\t\t\tyear\n\t\t\t\t\tgenres\n\t\t\t\t\ttags\n\t\t\t\t\tisbn\n\t\t\t\t\tisbn13\n\t\t\t\t\twriters\n\t\t\t\t\tartists\n\t\t\t\t\tcolorists\n\t\t\t\t\tletterers\n\t\t\t\t\tcoverArtists\n\t\t\t\t}\n\t\t\t\t... on ExternalSeriesMetadata {\n\t\t\t\t\tseriesTitle: title\n\t\t\t\t\talternativeTitles\n\t\t\t\t\tsummary\n\t\t\t\t\tvolumeCount\n\t\t\t\t\tcoverUrl\n\t\t\t\t\tstatus\n\t\t\t\t\tyear\n\t\t\t\t\tendYear\n\t\t\t\t\tgenres\n\t\t\t\t\ttags\n\t\t\t\t\tauthors\n\t\t\t\t\tageRating\n\t\t\t\t\tpublisher\n\t\t\t\t}\n\t\t\t}\n\t\t\tconfidence\n\t\t\tconfidenceFactors {\n\t\t\t\tfactor\n\t\t\t\tweight\n\t\t\t\tmatched\n\t\t\t}\n\t\t}\n\t\taddedAt\n\t\tupdatedAt\n\t\tmedia {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tmetadata {\n\t\t\t\ttitle\n\t\t\t\tsummary\n\t\t\t\tgenres\n\t\t\t\twriters\n\t\t\t\tcolorists\n\t\t\t\tletterers\n\t\t\t\tcoverArtists\n\t\t\t\tpublisher\n\t\t\t\tyear\n\t\t\t\tmonth\n\t\t\t\tday\n\t\t\t\tpageCount\n\t\t\t\tidentifierIsbn\n\t\t\t\tlockedFields\n\t\t\t}\n\t\t}\n\t\tseries {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tmetadata {\n\t\t\t\ttitle\n\t\t\t\tsummary\n\t\t\t\tgenres\n\t\t\t\twriters\n\t\t\t\tpublisher\n\t\t\t\tyear\n\t\t\t\tstatus\n\t\t\t\tageRating\n\t\t\t\tvolume\n\t\t\t\tlockedFields\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').PendingMatchRecordFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery PendingMetadataMatches {\n\t\tpendingMetadataMatches {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n"): typeof import('./graphql').PendingMetadataMatchesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation AcceptAllPendingMatches($strategy: MergeStrategy, $excludeFields: [MetadataField!]) {\n\t\tacceptAllPendingMatches(strategy: $strategy, excludeFields: $excludeFields)\n\t}\n"): typeof import('./graphql').AcceptAllPendingMatchesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation RejectAllPendingMatches {\n\t\trejectAllPendingMatches\n\t}\n"): typeof import('./graphql').RejectAllPendingMatchesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation AcceptMediaMatch(\n\t\t$mediaId: ID!\n\t\t$candidateIndex: Int!\n\t\t$strategy: MergeStrategy\n\t\t$excludeFields: [MetadataField!]\n\t\t$overrides: [MetadataFieldOverride!]\n\t) {\n\t\tacceptMediaMatch(\n\t\t\tmediaId: $mediaId\n\t\t\tcandidateIndex: $candidateIndex\n\t\t\tstrategy: $strategy\n\t\t\texcludeFields: $excludeFields\n\t\t\toverrides: $overrides\n\t\t) {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n"): typeof import('./graphql').AcceptMediaMatchDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation AcceptSeriesMatch(\n\t\t$seriesId: ID!\n\t\t$candidateIndex: Int!\n\t\t$strategy: MergeStrategy\n\t\t$excludeFields: [MetadataField!]\n\t\t$overrides: [MetadataFieldOverride!]\n\t) {\n\t\tacceptSeriesMatch(\n\t\t\tseriesId: $seriesId\n\t\t\tcandidateIndex: $candidateIndex\n\t\t\tstrategy: $strategy\n\t\t\texcludeFields: $excludeFields\n\t\t\toverrides: $overrides\n\t\t) {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n"): typeof import('./graphql').AcceptSeriesMatchDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation RejectMediaMatch($mediaId: ID!, $candidateIndex: Int!) {\n\t\trejectMediaMatch(mediaId: $mediaId, candidateIndex: $candidateIndex) {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n"): typeof import('./graphql').RejectMediaMatchDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation RejectSeriesMatch($seriesId: ID!, $candidateIndex: Int!) {\n\t\trejectSeriesMatch(seriesId: $seriesId, candidateIndex: $candidateIndex) {\n\t\t\t...PendingMatchRecord\n\t\t}\n\t}\n"): typeof import('./graphql').RejectSeriesMatchDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation SetMediaLockedFields($mediaId: ID!, $lockedFields: [MetadataField!]!) {\n\t\tsetMediaLockedFields(mediaId: $mediaId, lockedFields: $lockedFields) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').SetMediaLockedFieldsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation SetSeriesLockedFields($seriesId: ID!, $lockedFields: [MetadataField!]!) {\n\t\tsetSeriesLockedFields(seriesId: $seriesId, lockedFields: $lockedFields) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').SetSeriesLockedFieldsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery ProviderMatchMediaContext($id: ID!) {\n\t\tmediaById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t\tresolvedName\n\t\t}\n\t}\n"): typeof import('./graphql').ProviderMatchMediaContextDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery ProviderMatchSeriesContext($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t\tresolvedName\n\t\t}\n\t}\n"): typeof import('./graphql').ProviderMatchSeriesContextDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery ProviderMatchParse($name: String!) {\n\t\tparseComicFilename(name: $name) {\n\t\t\tseries\n\t\t\tnumber\n\t\t\tyear\n\t\t}\n\t}\n"): typeof import('./graphql').ProviderMatchParseDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery ProviderMatchProviders {\n\t\tmetadataProviderConfigs {\n\t\t\tid\n\t\t\tproviderType\n\t\t\tenabled\n\t\t\tposition\n\t\t}\n\t}\n"): typeof import('./graphql').ProviderMatchProvidersDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation ProviderMatchFindMedia(\n\t\t$id: ID!\n\t\t$query: MetadataSearchInput\n\t\t$provider: MetadataProvider\n\t) {\n\t\tfetchMediaMetadata(id: $id, query: $query, provider: $provider, autoApply: false) {\n\t\t\tprovider\n\t\t\texternalId\n\t\t\tconfidence\n\t\t\tmetadata {\n\t\t\t\t__typename\n\t\t\t\t... on ExternalMediaMetadata {\n\t\t\t\t\ttitle\n\t\t\t\t\tseriesName\n\t\t\t\t\tnumberRaw\n\t\t\t\t\tyear\n\t\t\t\t\tpublisher\n\t\t\t\t\twriters\n\t\t\t\t\tcoverUrl\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').ProviderMatchFindMediaDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation ProviderMatchFindSeries(\n\t\t$id: ID!\n\t\t$query: MetadataSearchInput\n\t\t$provider: MetadataProvider\n\t) {\n\t\tfetchSeriesMetadata(id: $id, query: $query, provider: $provider, autoApply: false) {\n\t\t\tprovider\n\t\t\texternalId\n\t\t\tconfidence\n\t\t\tmetadata {\n\t\t\t\t__typename\n\t\t\t\t... on ExternalSeriesMetadata {\n\t\t\t\t\ttitle\n\t\t\t\t\tyear\n\t\t\t\t\tpublisher\n\t\t\t\t\tauthors\n\t\t\t\t\tcoverUrl\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').ProviderMatchFindSeriesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation ProviderMatchAcceptMedia($mediaId: ID!, $candidateIndex: Int!) {\n\t\tacceptMediaMatch(mediaId: $mediaId, candidateIndex: $candidateIndex) {\n\t\t\tid\n\t\t\tstatus\n\t\t}\n\t}\n"): typeof import('./graphql').ProviderMatchAcceptMediaDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation ProviderMatchAcceptSeries($seriesId: ID!, $candidateIndex: Int!) {\n\t\tacceptSeriesMatch(seriesId: $seriesId, candidateIndex: $candidateIndex) {\n\t\t\tid\n\t\t\tstatus\n\t\t}\n\t}\n"): typeof import('./graphql').ProviderMatchAcceptSeriesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SideBarQuery {\n\t\tme {\n\t\t\tid\n\t\t\tpreferences {\n\t\t\t\tnavigationArrangement {\n\t\t\t\t\tlocked\n\t\t\t\t\tsections {\n\t\t\t\t\t\tconfig {\n\t\t\t\t\t\t\t__typename\n\t\t\t\t\t\t\t... on SystemArrangementConfig {\n\t\t\t\t\t\t\t\tvariant\n\t\t\t\t\t\t\t\tlinks\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}\n\t\t\t\t\t\tvisible\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').SideBarQueryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BookClubSideBarSection {\n\t\tbookClubs {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t\temoji\n\t\t\tmembers {\n\t\t\t\tid\n\t\t\t\tuserId\n\t\t\t\trole\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').BookClubSideBarSectionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UpdateLibraryEmoji($id: ID!, $emoji: String) {\n\t\tupdateLibraryEmoji(id: $id, emoji: $emoji) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').UpdateLibraryEmojiDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation ScanLibraryMutation($id: ID!) {\n\t\tscanLibrary(id: $id)\n\t}\n"): typeof import('./graphql').ScanLibraryMutationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery LibrarySideBarSection {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\temoji\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').LibrarySideBarSectionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SmartListSideBarSection {\n\t\tsmartLists {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').SmartListSideBarSectionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery TopNavigation {\n\t\tme {\n\t\t\tid\n\t\t\tpreferences {\n\t\t\t\tnavigationArrangement {\n\t\t\t\t\tlocked\n\t\t\t\t\tsections {\n\t\t\t\t\t\tconfig {\n\t\t\t\t\t\t\t__typename\n\t\t\t\t\t\t\t... on SystemArrangementConfig {\n\t\t\t\t\t\t\t\tvariant\n\t\t\t\t\t\t\t\tlinks\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}\n\t\t\t\t\t\tvisible\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').TopNavigationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BookClubNavigationItem {\n\t\tbookClubs {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t\temoji\n\t\t}\n\t}\n"): typeof import('./graphql').BookClubNavigationItemDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery LibraryNavigationItem {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\temoji\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').LibraryNavigationItemDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SmartListNavigationItem {\n\t\tsmartLists {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').SmartListNavigationItemDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery EpubJsReader($id: ID!) {\n\t\tepubById(id: $id) {\n\t\t\tmediaId\n\t\t\trootBase\n\t\t\trootFile\n\t\t\textraCss\n\t\t\ttoc\n\t\t\tresources\n\t\t\tmetadata\n\t\t\tspine {\n\t\t\t\tid\n\t\t\t\tidref\n\t\t\t\tproperties\n\t\t\t\tlinear\n\t\t\t}\n\t\t\tbookmarks {\n\t\t\t\tid\n\t\t\t\tuserId\n\t\t\t\tepubcfi\n\t\t\t\tmediaId\n\t\t\t\tcreatedAt\n\t\t\t}\n\t\t\tmedia {\n\t\t\t\tid\n\t\t\t\tresolvedName\n\t\t\t\tpages\n\t\t\t\textension\n\t\t\t\treadProgress {\n\t\t\t\t\tpercentageCompleted\n\t\t\t\t\tepubcfi\n\t\t\t\t\tpage\n\t\t\t\t\telapsedSeconds\n\t\t\t\t}\n\t\t\t\tlibraryConfig {\n\t\t\t\t\tdefaultReadingImageScaleFit\n\t\t\t\t\tdefaultReadingMode\n\t\t\t\t\tdefaultReadingDir\n\t\t\t\t}\n\t\t\t\tnextInSeries(pagination: { cursor: { limit: 1 } }) {\n\t\t\t\t\tnodes {\n\t\t\t\t\t\tid\n\t\t\t\t\t\tname: resolvedName\n\t\t\t\t\t\tthumbnail {\n\t\t\t\t\t\t\turl\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').EpubJsReaderDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CreateBookmark($input: BookmarkInput!) {\n\t\tcreateBookmark(input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n"): typeof import('./graphql').CreateBookmarkDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteBookmarkByEpubcfi($epubcfi: String!) {\n\t\tdeleteBookmarkByEpubcfi(epubcfi: $epubcfi) {\n\t\t\t__typename\n\t\t}\n\t}\n"): typeof import('./graphql').DeleteBookmarkByEpubcfiDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SeriesBooksAlphabet($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tmediaAlphabet\n\t\t}\n\t}\n"): typeof import('./graphql').SeriesBooksAlphabetDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment SeriesMetadataEditor on SeriesMetadata {\n\t\tageRating\n\t\tbooktype\n\t\tcharacters\n\t\tcollects {\n\t\t\tseries\n\t\t\tcomicid\n\t\t\tissueid\n\t\t\tissues\n\t\t}\n\t\tcomicImage\n\t\tcomicid\n\t\tdescriptionFormatted\n\t\tgenres\n\t\timprint\n\t\tlinks\n\t\tmetaType\n\t\tpublicationRun\n\t\tpublisher\n\t\tstatus\n\t\tsummary\n\t\ttitle\n\t\ttotalIssues\n\t\tvolume\n\t\twriters\n\t\tyear\n\t\tlockedFields\n\t}\n"): typeof import('./graphql').SeriesMetadataEditorFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UpdateSeriesMetadata($id: ID!, $input: SeriesMetadataInput!) {\n\t\tupdateSeriesMetadata(id: $id, input: $input) {\n\t\t\tmetadata {\n\t\t\t\t...SeriesMetadataEditor\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').UpdateSeriesMetadataDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation SeriesEditorSetLockedFields($seriesId: ID!, $lockedFields: [MetadataField!]!) {\n\t\tsetSeriesLockedFields(seriesId: $seriesId, lockedFields: $lockedFields) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').SeriesEditorSetLockedFieldsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tsubscription UseCoreEvent {\n\t\treadEvents {\n\t\t\t__typename\n\t\t\t... on CreatedManySeries {\n\t\t\t\tcount\n\t\t\t\tlibraryId\n\t\t\t}\n\t\t\t... on CreatedMedia {\n\t\t\t\tid\n\t\t\t\tseriesId\n\t\t\t}\n\t\t\t... on CreatedOrUpdatedManyMedia {\n\t\t\t\tcount\n\t\t\t\tseriesId\n\t\t\t}\n\t\t\t... on DiscoveredMissingLibrary {\n\t\t\t\tid\n\t\t\t}\n\t\t\t... on JobStarted {\n\t\t\t\tid\n\t\t\t}\n\t\t\t... on JobUpdate {\n\t\t\t\t__typename\n\t\t\t\tid\n\t\t\t\tstatus\n\t\t\t\tmessage\n\t\t\t\tcompletedTasks\n\t\t\t\tremainingTasks\n\t\t\t\tcompletedSubtasks\n\t\t\t\ttotalSubtasks\n\t\t\t\tsubtitle\n\t\t\t}\n\t\t\t... on JobOutput {\n\t\t\t\tid\n\t\t\t\toutput {\n\t\t\t\t\t__typename\n\t\t\t\t\t... on LibraryScanOutput {\n\t\t\t\t\t\tcreatedMedia\n\t\t\t\t\t\tcreatedSeries\n\t\t\t\t\t\tupdatedMedia\n\t\t\t\t\t\tupdatedSeries\n\t\t\t\t\t}\n\t\t\t\t\t... on SeriesScanOutput {\n\t\t\t\t\t\tcreatedMedia\n\t\t\t\t\t\tupdatedMedia\n\t\t\t\t\t}\n\t\t\t\t\t... on OrganizeLooseFilesOutput {\n\t\t\t\t\t\tmoved\n\t\t\t\t\t\tproposedMoves\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').UseCoreEventDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UsePreferences($input: UpdateUserPreferencesInput!) {\n\t\tupdateViewerPreferences(input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n"): typeof import('./graphql').UsePreferencesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UpdateReadProgress($id: ID!, $input: MediaProgressInput!) {\n\t\tupdateMediaProgress(id: $id, input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n"): typeof import('./graphql').UpdateReadProgressDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation BookActionMenuComplete($id: ID!) {\n\t\tfinishMediaProgress(id: $id)\n\t}\n"): typeof import('./graphql').BookActionMenuCompleteDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation BookActionMenuDeleteSession($id: ID!) {\n\t\tclearMediaProgress(id: $id)\n\t}\n"): typeof import('./graphql').BookActionMenuDeleteSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation BookActionMenuDeleteHistory($id: ID!) {\n\t\tdeleteMediaReadingHistory(id: $id)\n\t}\n"): typeof import('./graphql').BookActionMenuDeleteHistoryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment BookFileInformation on Media {\n\t\tid\n\t\tsize\n\t\textension\n\t\thash\n\t\trelativeLibraryPath\n\t}\n"): typeof import('./graphql').BookFileInformationFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BookLibrarySeriesLinks($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tlibrary {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').BookLibrarySeriesLinksDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment BookMetadata on Media {\n\t\tmetadata {\n\t\t\tageRating\n\t\t\tcharacters\n\t\t\tcolorists\n\t\t\tcoverArtists\n\t\t\teditors\n\t\t\tgenres\n\t\t\tinkers\n\t\t\tletterers\n\t\t\tlinks\n\t\t\tpencillers\n\t\t\tpublisher\n\t\t\tteams\n\t\t\twriters\n\t\t\tyear\n\t\t\tmonth\n\t\t\tday\n\t\t\tvolume\n\t\t\tnumber\n\t\t}\n\t}\n"): typeof import('./graphql').BookMetadataFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BooksAfterCurrentQuery($id: ID!, $pagination: Pagination) {\n\t\tmediaById(id: $id) {\n\t\t\tnextInSeries(pagination: $pagination) {\n\t\t\t\tnodes {\n\t\t\t\t\tid\n\t\t\t\t\t...BookCard\n\t\t\t\t}\n\t\t\t\tpageInfo {\n\t\t\t\t\t__typename\n\t\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\t\tcurrentCursor\n\t\t\t\t\t\tnextCursor\n\t\t\t\t\t\tlimit\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').BooksAfterCurrentQueryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BooksAlphabet {\n\t\tmediaAlphabet\n\t}\n"): typeof import('./graphql').BooksAlphabetDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery EmailBookDropdownDevice {\n\t\temailDevices {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').EmailBookDropdownDeviceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation SendEmailAttachment($id: ID!, $sendTo: [EmailerSendTo!]!) {\n\t\tsendAttachmentEmail(input: { mediaIds: [$id], sendTo: $sendTo }) {\n\t\t\tsentCount\n\t\t\terrors\n\t\t}\n\t}\n"): typeof import('./graphql').SendEmailAttachmentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BookReaderScene($id: ID!) {\n\t\tmediaById(id: $id) {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tpages\n\t\t\textension\n\t\t\treadProgress {\n\t\t\t\tpercentageCompleted\n\t\t\t\tepubcfi\n\t\t\t\tpage\n\t\t\t\telapsedSeconds\n\t\t\t}\n\t\t\tlibraryConfig {\n\t\t\t\tdefaultReadingImageScaleFit\n\t\t\t\tdefaultReadingMode\n\t\t\t\tdefaultReadingDir\n\t\t\t}\n\t\t\tanalysisData {\n\t\t\t\tdimensions {\n\t\t\t\t\theight\n\t\t\t\t\twidth\n\t\t\t\t}\n\t\t\t}\n\t\t\tnextInSeries(pagination: { cursor: { limit: 1 } }) {\n\t\t\t\tnodes {\n\t\t\t\t\tid\n\t\t\t\t\tname: resolvedName\n\t\t\t\t\tthumbnail {\n\t\t\t\t\t\turl\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').BookReaderSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BookManagementScene($id: ID!) {\n\t\tmediaById(id: $id) {\n\t\t\tid\n\t\t\tresolvedName\n\t\t\tlibrary {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tseries {\n\t\t\t\tid\n\t\t\t\tresolvedName\n\t\t\t}\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\t...BookThumbnailSelector\n\t\t}\n\t}\n"): typeof import('./graphql').BookManagementSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation BookManagementSceneAnalyze($id: ID!) {\n\t\tanalyzeMedia(id: $id)\n\t}\n"): typeof import('./graphql').BookManagementSceneAnalyzeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation BookTagEditorSetTags($id: ID!, $tags: [String!]!) {\n\t\tsetMediaTags(id: $id, tags: $tags) {\n\t\t\tid\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').BookTagEditorSetTagsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment BookThumbnailSelector on Media {\n\t\tid\n\t\tthumbnail {\n\t\t\turl\n\t\t}\n\t\tpages\n\t}\n"): typeof import('./graphql').BookThumbnailSelectorFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation BookThumbnailSelectorUpdate($id: ID!, $input: PageBasedThumbnailInput!) {\n\t\tupdateMediaThumbnail(id: $id, input: $input) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').BookThumbnailSelectorUpdateDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation BookThumbnailSelectorUpload($id: ID!, $file: Upload!) {\n\t\tuploadMediaThumbnail(id: $id, file: $file) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').BookThumbnailSelectorUploadDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BookClubLayout($slug: String!) {\n\t\tbookClubBySlug(slug: $slug) {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t\tdescription\n\t\t\tisPrivate\n\t\t\troleSpec\n\t\t\tcreator {\n\t\t\t\tid\n\t\t\t\tdisplayName\n\t\t\t\tavatarUrl\n\t\t\t}\n\t\t\tmembersCount\n\t\t\tmembership {\n\t\t\t\trole\n\t\t\t\tavatarUrl\n\t\t\t\tisCreator\n\t\t\t}\n\t\t\tcurrentBook {\n\t\t\t\tid\n\t\t\t\ttitle\n\t\t\t\tauthor\n\t\t\t\timageUrl\n\t\t\t\tentity {\n\t\t\t\t\tid\n\t\t\t\t\tthumbnail {\n\t\t\t\t\t\turl\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\t...BookClubBookItem\n\t\t\t}\n\t\t\tcreatedAt\n\t\t}\n\t}\n"): typeof import('./graphql').BookClubLayoutDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UpdateBookClub($id: ID!, $input: UpdateBookClubInput!) {\n\t\tupdateBookClub(id: $id, input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t\temoji\n\t\t\tisPrivate\n\t\t\troleSpec\n\t\t\tdescription\n\t\t}\n\t}\n"): typeof import('./graphql').UpdateBookClubDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery UserBookClubsScene {\n\t\tbookClubs(all: false) {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t\tdescription\n\t\t\tmembersCount\n\t\t\tcurrentBook {\n\t\t\t\tid\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').UserBookClubsSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery CreateBookClubForm {\n\t\tbookClubs {\n\t\t\tname\n\t\t\tslug\n\t\t}\n\t}\n"): typeof import('./graphql').CreateBookClubFormDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CreateBookClubScene($input: CreateBookClubInput!) {\n\t\tcreateBookClub(input: $input) {\n\t\t\tid\n\t\t\tslug\n\t\t}\n\t}\n"): typeof import('./graphql').CreateBookClubSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BookClubBasicSettingsScene {\n\t\tbookClubs(all: true) {\n\t\t\tid\n\t\t\tname\n\t\t\tslug\n\t\t}\n\t}\n"): typeof import('./graphql').BookClubBasicSettingsSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BookClubMembersTable($id: ID!) {\n\t\tbookClubById(id: $id) {\n\t\t\tid\n\t\t\tmembers {\n\t\t\t\tid\n\t\t\t\tavatarUrl\n\t\t\t\tisCreator\n\t\t\t\tdisplayName\n\t\t\t\trole\n\t\t\t\tuserId\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').BookClubMembersTableDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation RemoveBookClubMember($bookClubId: ID!, $memberId: ID!) {\n\t\tremoveBookClubMember(bookClubId: $bookClubId, memberId: $memberId) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').RemoveBookClubMemberDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BookSearchScene(\n\t\t$filter: MediaFilterInput!\n\t\t$orderBy: [MediaOrderBy!]!\n\t\t$pagination: Pagination!\n\t) {\n\t\tmedia(filter: $filter, orderBy: $orderBy, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...BookCard\n\t\t\t\t...BookMetadata\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').BookSearchSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery CreateLibrarySceneExistingLibraries {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\tpath\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').CreateLibrarySceneExistingLibrariesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CreateLibrarySceneCreateLibrary($input: CreateOrUpdateLibraryInput!) {\n\t\tcreateLibrary(input: $input) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').CreateLibrarySceneCreateLibraryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery CreateSmartListForm {\n\t\tsmartLists(input: { mine: true }) {\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').CreateSmartListFormDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CreateSmartListScene($input: SaveSmartListInput!) {\n\t\tcreateSmartList(input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').CreateSmartListSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment ContinueReadingBook on Media {\n\t\tid\n\t\tresolvedName\n\t\tpages\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t}\n\t\treadProgress {\n\t\t\tpercentageCompleted\n\t\t\tepubcfi\n\t\t\tpage\n\t\t\tupdatedAt\n\t\t}\n\t}\n"): typeof import('./graphql').ContinueReadingBookFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery ContinueReadingMedia($pagination: Pagination!) {\n\t\tkeepReading(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...ContinueReadingBook\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').ContinueReadingMediaDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery HomeSceneQuery {\n\t\tnumberOfLibraries\n\t}\n"): typeof import('./graphql').HomeSceneQueryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment OnDeckBook on Media {\n\t\tid\n\t\tmetadata {\n\t\t\tnumber\n\t\t}\n\t\tresolvedName\n\t\tseriesPosition\n\t\tseries {\n\t\t\tmediaCount\n\t\t\tmetadata {\n\t\t\t\ttotalIssues\n\t\t\t}\n\t\t}\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').OnDeckBookFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery OnDeckBooksWeb($pagination: Pagination!) {\n\t\tonDeck(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...OnDeckBook\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').OnDeckBooksWebDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment RecentlyAddedBook on Media {\n\t\tid\n\t\tresolvedName\n\t\tcreatedAt\n\t\tthumbnail {\n\t\t\turl\n\t\t\tmetadata {\n\t\t\t\taverageColor\n\t\t\t\tcolors {\n\t\t\t\t\tcolor\n\t\t\t\t\tpercentage\n\t\t\t\t}\n\t\t\t\tthumbhash\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').RecentlyAddedBookFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery RecentlyAddedMedia($pagination: Pagination!) {\n\t\trecentlyAddedMedia(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...RecentlyAddedBook\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').RecentlyAddedMediaDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery RecentlyAddedSeries($pagination: Pagination!) {\n\t\trecentlyAddedSeries(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tresolvedName\n\t\t\t\tmediaCount\n\t\t\t\tpercentageCompleted\n\t\t\t\tstatus\n\t\t\t\tcreatedAt\n\t\t\t\tmedia(take: 2, skip: 1) {\n\t\t\t\t\tid\n\t\t\t\t\tresolvedName\n\t\t\t\t\tthumbnail {\n\t\t\t\t\t\turl\n\t\t\t\t\t\tmetadata {\n\t\t\t\t\t\t\taverageColor\n\t\t\t\t\t\t\tcolors {\n\t\t\t\t\t\t\t\tcolor\n\t\t\t\t\t\t\t\tpercentage\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\tthumbhash\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\tthumbnail {\n\t\t\t\t\turl\n\t\t\t\t\tmetadata {\n\t\t\t\t\t\taverageColor\n\t\t\t\t\t\tcolors {\n\t\t\t\t\t\t\tcolor\n\t\t\t\t\t\t\tpercentage\n\t\t\t\t\t\t}\n\t\t\t\t\t\tthumbhash\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').RecentlyAddedSeriesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery LibraryLayout($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t\tdescription\n\t\t\tpath\n\t\t\tstats {\n\t\t\t\tseriesCount\n\t\t\t\tbookCount\n\t\t\t\tcompletedBooks\n\t\t\t\tinProgressBooks\n\t\t\t\ttotalBytes\n\t\t\t\ttotalReadingTimeSeconds\n\t\t\t}\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t\tmetadata {\n\t\t\t\t\taverageColor\n\t\t\t\t\tthumbhash\n\t\t\t\t\tcolors {\n\t\t\t\t\t\tcolor\n\t\t\t\t\t\tpercentage\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tconfig {\n\t\t\t\tdefaultLibraryViewMode\n\t\t\t\thideSeriesView\n\t\t\t}\n\t\t\t...LibrarySettingsConfig\n\t\t}\n\t}\n"): typeof import('./graphql').LibraryLayoutDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation VisitLibrary($id: ID!) {\n\t\tvisitLibrary(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').VisitLibraryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery LibraryBooksScene(\n\t\t$filter: MediaFilterInput!\n\t\t$orderBy: [MediaOrderBy!]!\n\t\t$pagination: Pagination!\n\t) {\n\t\tmedia(filter: $filter, orderBy: $orderBy, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...BookCard\n\t\t\t\t...BookMetadata\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').LibraryBooksSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery LibrarySeries(\n\t\t$filter: SeriesFilterInput!\n\t\t$orderBy: [SeriesOrderBy!]!\n\t\t$pagination: Pagination!\n\t) {\n\t\tseries(filter: $filter, orderBy: $orderBy, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tresolvedName\n\t\t\t\tmediaCount\n\t\t\t\tpercentageCompleted\n\t\t\t\tstatus\n\t\t\t\t# We fetch 2 and skip 1 because the first thumbnail _might_ be the same as the series thumbnail.\n\t\t\t\t# See https://github.com/stumpapp/stump/issues/899\n\t\t\t\tmedia(take: 2, skip: 1) {\n\t\t\t\t\tid\n\t\t\t\t\tthumbnail {\n\t\t\t\t\t\turl\n\t\t\t\t\t\tmetadata {\n\t\t\t\t\t\t\taverageColor\n\t\t\t\t\t\t\tcolors {\n\t\t\t\t\t\t\t\tcolor\n\t\t\t\t\t\t\t\tpercentage\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\tthumbhash\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\tthumbnail {\n\t\t\t\t\turl\n\t\t\t\t\tmetadata {\n\t\t\t\t\t\taverageColor\n\t\t\t\t\t\tcolors {\n\t\t\t\t\t\t\tcolor\n\t\t\t\t\t\t\tpercentage\n\t\t\t\t\t\t}\n\t\t\t\t\t\tthumbhash\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\ttotalPages\n\t\t\t\t\tcurrentPage\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').LibrarySeriesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery LibrarySeriesGrid($id: String!, $pagination: Pagination) {\n\t\tseries(filter: { libraryId: { eq: $id } }, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tthumbnail {\n\t\t\t\t\turl\n\t\t\t\t}\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').LibrarySeriesGridDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment LibrarySettingsConfig on Library {\n\t\tconfig {\n\t\t\tid\n\t\t\tconvertRarToZip\n\t\t\thardDeleteConversions\n\t\t\tdefaultReadingDir\n\t\t\tdefaultReadingMode\n\t\t\tdefaultReadingImageScaleFit\n\t\t\tdefaultLibraryViewMode\n\t\t\thideSeriesView\n\t\t\tskipBookOverview\n\t\t\tgenerateFileHashes\n\t\t\tgenerateKoreaderHashes\n\t\t\tprocessMetadata\n\t\t\twriteComicinfo\n\t\t\twatch\n\t\t\tautoOrganizeLooseFiles\n\t\t\tlibraryPattern\n\t\t\tlibraryType\n\t\t\tthumbnailConfig {\n\t\t\t\t__typename\n\t\t\t\tresizeMethod {\n\t\t\t\t\t__typename\n\t\t\t\t\t... on ScaleEvenlyByFactor {\n\t\t\t\t\t\tfactor\n\t\t\t\t\t}\n\t\t\t\t\t... on ExactDimensionResize {\n\t\t\t\t\t\twidth\n\t\t\t\t\t\theight\n\t\t\t\t\t}\n\t\t\t\t\t... on ScaledDimensionResize {\n\t\t\t\t\t\tdimension\n\t\t\t\t\t\tsize\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\tformat\n\t\t\t\tquality\n\t\t\t\tpage\n\t\t\t}\n\t\t\tprocessThumbnailColorsEvenWithoutConfig\n\t\t\tignoreRules\n\t\t}\n\t}\n"): typeof import('./graphql').LibrarySettingsConfigFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation LibrarySettingsRouterEditLibraryMutation($id: ID!, $input: CreateOrUpdateLibraryInput!) {\n\t\tupdateLibrary(id: $id, input: $input) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').LibrarySettingsRouterEditLibraryMutationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation LibrarySettingsRouterScanLibraryMutation($id: ID!, $options: JSON) {\n\t\tscanLibrary(id: $id, options: $options)\n\t}\n"): typeof import('./graphql').LibrarySettingsRouterScanLibraryMutationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery BasicSettingsSceneExistingLibraries {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\tpath\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').BasicSettingsSceneExistingLibrariesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery LibraryExclusionsUsersQuery {\n\t\tusers(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').LibraryExclusionsUsersQueryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery LibraryExclusionsQuery($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\texcludedUsers {\n\t\t\t\tid\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').LibraryExclusionsQueryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UpdateLibraryExclusions($id: ID!, $userIds: [String!]!) {\n\t\tupdateLibraryExcludedUsers(id: $id, userIds: $userIds) {\n\t\t\tid\n\t\t\texcludedUsers {\n\t\t\t\tid\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').UpdateLibraryExclusionsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CleanLibrary($id: ID!) {\n\t\tcleanLibrary(id: $id) {\n\t\t\tdeletedMediaCount\n\t\t\tdeletedSeriesCount\n\t\t\tisEmpty\n\t\t}\n\t}\n"): typeof import('./graphql').CleanLibraryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery LibraryMissingEntities($libraryId: ID!, $pagination: Pagination!) {\n\t\tlibraryMissingEntities(libraryId: $libraryId, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tpath\n\t\t\t\ttype\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\ttotalPages\n\t\t\t\t\tcurrentPage\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t\ttotalItems\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').LibraryMissingEntitiesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation AnalyzeLibraryMedia($id: ID!) {\n\t\tanalyzeLibrary(id: $id)\n\t}\n"): typeof import('./graphql').AnalyzeLibraryMediaDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery InitFetchJobCheckProviders {\n\t\tmetadataProviderConfigs {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').InitFetchJobCheckProvidersDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation InitFetchJob($id: ID!) {\n\t\tfetchLibraryMetadata(id: $id)\n\t}\n"): typeof import('./graphql').InitFetchJobDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation OrganizeLooseFilesPlan($libraryId: ID!) {\n\t\tplanOrganizeLooseFiles(libraryId: $libraryId)\n\t}\n"): typeof import('./graphql').OrganizeLooseFilesPlanDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation OrganizeLooseFilesApply($libraryId: ID!, $decisions: [OrganizeDecisionInput!]!) {\n\t\tapplyOrganizeLooseFiles(libraryId: $libraryId, decisions: $decisions)\n\t}\n"): typeof import('./graphql').OrganizeLooseFilesApplyDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery OrganizePreview($libraryId: ID!) {\n\t\torganizePreview(libraryId: $libraryId) {\n\t\t\tproposedMoves {\n\t\t\t\tsrc\n\t\t\t\tdst\n\t\t\t\tcanonicalName\n\t\t\t\tyear\n\t\t\t\texternalId\n\t\t\t\tprovider\n\t\t\t\tconfidence\n\t\t\t\tbucket\n\t\t\t\texistingSeriesId\n\t\t\t}\n\t\t\tunmatched {\n\t\t\t\tsrc\n\t\t\t\tparsedSeries\n\t\t\t\treason\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').OrganizePreviewDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation ScanHistorySectionClearHistory($id: ID!) {\n\t\tclearScanHistory(id: $id)\n\t}\n"): typeof import('./graphql').ScanHistorySectionClearHistoryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery ScanHistoryTable($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tid\n\t\t\tscanHistory {\n\t\t\t\tid\n\t\t\t\tjobId\n\t\t\t\ttimestamp\n\t\t\t\toptions\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').ScanHistoryTableDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery ScanRecordInspectorJobs($id: ID!, $loadLogs: Boolean!) {\n\t\tjobById(id: $id) {\n\t\t\tid\n\t\t\toutputData {\n\t\t\t\t__typename\n\t\t\t\t... on LibraryScanOutput {\n\t\t\t\t\ttotalFiles\n\t\t\t\t\ttotalDirectories\n\t\t\t\t\tignoredFiles\n\t\t\t\t\tskippedFiles\n\t\t\t\t\tignoredDirectories\n\t\t\t\t\tcreatedMedia\n\t\t\t\t\tupdatedMedia\n\t\t\t\t\tcreatedSeries\n\t\t\t\t\tupdatedSeries\n\t\t\t\t}\n\t\t\t}\n\t\t\tlogs @include(if: $loadLogs) {\n\t\t\t\tid\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').ScanRecordInspectorJobsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteLibraryThumbnails($id: ID!) {\n\t\tdeleteLibraryThumbnails(id: $id)\n\t}\n"): typeof import('./graphql').DeleteLibraryThumbnailsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation LibraryThumbnailSelectorUpdate($id: ID!, $input: UpdateThumbnailInput!) {\n\t\tupdateLibraryThumbnail(id: $id, input: $input) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').LibraryThumbnailSelectorUpdateDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation LibraryThumbnailSelectorUpload($id: ID!, $file: Upload!) {\n\t\tuploadLibraryThumbnail(id: $id, file: $file) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').LibraryThumbnailSelectorUploadDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation ProcessLibraryThumbnails($id: ID!, $forceRegenerate: Boolean!) {\n\t\tprocessLibraryThumbnails(id: $id, forceRegenerate: $forceRegenerate)\n\t}\n"): typeof import('./graphql').ProcessLibraryThumbnailsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation RegenerateThumbnails($id: ID!, $forceRegenerate: Boolean!) {\n\t\tgenerateLibraryThumbnails(id: $id, forceRegenerate: $forceRegenerate)\n\t}\n"): typeof import('./graphql').RegenerateThumbnailsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation SeriesActionComplete($id: ID!) {\n\t\tfinishSeriesProgress(id: $id)\n\t}\n"): typeof import('./graphql').SeriesActionCompleteDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SeriesLayout($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\tpath\n\t\t\tlibrary {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tresolvedName\n\t\t\tresolvedDescription\n\t\t\tstats {\n\t\t\t\tbookCount\n\t\t\t\tcompletedBooks\n\t\t\t\tinProgressBooks\n\t\t\t\ttotalBytes\n\t\t\t\ttotalReadingTimeSeconds\n\t\t\t}\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t\tmetadata {\n\t\t\t\t\taverageColor\n\t\t\t\t\tthumbhash\n\t\t\t\t\tcolors {\n\t\t\t\t\t\tcolor\n\t\t\t\t\t\tpercentage\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tcreatedAt\n\t\t\tupdatedAt\n\t\t}\n\t}\n"): typeof import('./graphql').SeriesLayoutDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SeriesLibrayLink($id: ID!) {\n\t\tlibraryById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').SeriesLibrayLinkDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SeriesOverviewSheetExtas($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\tmetadata {\n\t\t\t\tpublisher\n\t\t\t\tyear\n\t\t\t\tsummary\n\t\t\t\tlinks\n\t\t\t}\n\t\t\tupNext(take: 10) {\n\t\t\t\tid\n\t\t\t\t...SimpleBookCard\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').SeriesOverviewSheetExtasDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SeriesBooksScene(\n\t\t$filter: MediaFilterInput!\n\t\t$orderBy: [MediaOrderBy!]!\n\t\t$pagination: Pagination!\n\t) {\n\t\tmedia(filter: $filter, orderBy: $orderBy, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\t...BookCard\n\t\t\t\t...BookMetadata\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').SeriesBooksSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SeriesBookGrid($id: String!, $pagination: Pagination) {\n\t\tmedia(filter: { seriesId: { eq: $id } }, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tthumbnail {\n\t\t\t\t\turl\n\t\t\t\t}\n\t\t\t\tpages\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on CursorPaginationInfo {\n\t\t\t\t\tcurrentCursor\n\t\t\t\t\tnextCursor\n\t\t\t\t\tlimit\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').SeriesBookGridDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SeriesSettingsScene($id: ID!) {\n\t\tseriesById(id: $id) {\n\t\t\tid\n\t\t\t...SeriesThumbnailSelector\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t\tmetadata {\n\t\t\t\t...SeriesMetadataEditor\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').SeriesSettingsSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation SeriesSettingsSceneAnalyze($id: ID!) {\n\t\tanalyzeSeries(id: $id)\n\t}\n"): typeof import('./graphql').SeriesSettingsSceneAnalyzeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation SeriesSettingsSceneResetMetadata($id: ID!, $impact: MetadataResetImpact!) {\n\t\tresetSeriesMetadata(id: $id, impact: $impact) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').SeriesSettingsSceneResetMetadataDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation SeriesTagEditorSetTags($id: ID!, $tags: [String!]!) {\n\t\tsetSeriesTags(id: $id, tags: $tags) {\n\t\t\tid\n\t\t\ttags {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').SeriesTagEditorSetTagsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment SeriesThumbnailSelector on Series {\n\t\tid\n\t\tthumbnail {\n\t\t\turl\n\t\t}\n\t}\n"): typeof import('./graphql').SeriesThumbnailSelectorFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation SeriesThumbnailSelectorUpdate($id: ID!, $input: UpdateThumbnailInput!) {\n\t\tupdateSeriesThumbnail(id: $id, input: $input) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').SeriesThumbnailSelectorUpdateDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation SeriesThumbnailSelectorUpload($id: ID!, $file: Upload!) {\n\t\tuploadSeriesThumbnail(id: $id, file: $file) {\n\t\t\tid\n\t\t\tthumbnail {\n\t\t\t\turl\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').SeriesThumbnailSelectorUploadDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery APIKeyTable {\n\t\tapiKeys {\n\t\t\tid\n\t\t\tname\n\t\t\tpermissions {\n\t\t\t\t__typename\n\t\t\t\t... on UserPermissionStruct {\n\t\t\t\t\tvalue\n\t\t\t\t}\n\t\t\t}\n\t\t\tlastUsedAt\n\t\t\texpiresAt\n\t\t\tcreatedAt\n\t\t}\n\t}\n"): typeof import('./graphql').ApiKeyTableDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CreateAPIKeyModal($input: ApikeyInput!) {\n\t\tcreateApiKey(input: $input) {\n\t\t\tapiKey {\n\t\t\t\tid\n\t\t\t}\n\t\t\tsecret\n\t\t}\n\t}\n"): typeof import('./graphql').CreateApiKeyModalDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteAPIKeyConfirmModal($id: Int!) {\n\t\tdeleteApiKey(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').DeleteApiKeyConfirmModalDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UploadUserAvatar($file: Upload!) {\n\t\tuploadUserAvatar(upload: $file) {\n\t\t\tid\n\t\t\tavatarUrl\n\t\t}\n\t}\n"): typeof import('./graphql').UploadUserAvatarDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteUserAvatar {\n\t\tdeleteUserAvatar {\n\t\t\tid\n\t\t\tavatarUrl\n\t\t}\n\t}\n"): typeof import('./graphql').DeleteUserAvatarDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UpdateUserProfileForm($input: UpdateUserInput!) {\n\t\tupdateViewer(input: $input) {\n\t\t\tid\n\t\t\tusername\n\t\t}\n\t}\n"): typeof import('./graphql').UpdateUserProfileFormDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery NavigationArrangement {\n\t\tme {\n\t\t\tpreferences {\n\t\t\t\tnavigationArrangement {\n\t\t\t\t\tlocked\n\t\t\t\t\tsections {\n\t\t\t\t\t\t__typename\n\t\t\t\t\t\tconfig {\n\t\t\t\t\t\t\t__typename\n\t\t\t\t\t\t\t... on SystemArrangementConfig {\n\t\t\t\t\t\t\t\tvariant\n\t\t\t\t\t\t\t\tlinks\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}\n\t\t\t\t\t\tvisible\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').NavigationArrangementDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation NavigationArrangementUpdate($input: NavigationArrangementInput!) {\n\t\tupdateNavigationArrangement(input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n"): typeof import('./graphql').NavigationArrangementUpdateDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation NavigationArrangementUpdateLockStatus($locked: Boolean!) {\n\t\tupdateNavigationArrangementLock(locked: $locked) {\n\t\t\t__typename\n\t\t}\n\t}\n"): typeof import('./graphql').NavigationArrangementUpdateLockStatusDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery CreateEmailerSceneEmailers {\n\t\temailers {\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').CreateEmailerSceneEmailersDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CreateEmailerSceneCreateEmailer($input: EmailerInput!) {\n\t\tcreateEmailer(input: $input) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').CreateEmailerSceneCreateEmailerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery EditEmailerScene($id: Int!) {\n\t\temailers {\n\t\t\tname\n\t\t}\n\t\temailerById(id: $id) {\n\t\t\tid\n\t\t\tname\n\t\t\tisPrimary\n\t\t\tsmtpHost\n\t\t\tsmtpPort\n\t\t\tlastUsedAt\n\t\t\tmaxAttachmentSizeBytes\n\t\t\tsenderDisplayName\n\t\t\tsenderEmail\n\t\t\ttlsEnabled\n\t\t\tusername\n\t\t}\n\t}\n"): typeof import('./graphql').EditEmailerSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation EditEmailerSceneEditEmailer($id: Int!, $input: EmailerInput!) {\n\t\tupdateEmailer(id: $id, input: $input) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').EditEmailerSceneEditEmailerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CreateOrUpdateDeviceModalCreateEmailDevice($input: EmailDeviceInput!) {\n\t\tcreateEmailDevice(input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').CreateOrUpdateDeviceModalCreateEmailDeviceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CreateOrUpdateDeviceModalUpdateEmailDevice($id: Int!, $input: EmailDeviceInput!) {\n\t\tupdateEmailDevice(id: $id, input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t\tforbidden\n\t\t}\n\t}\n"): typeof import('./graphql').CreateOrUpdateDeviceModalUpdateEmailDeviceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteDeviceConfirmationDeleteEmailDevice($id: Int!) {\n\t\tdeleteEmailDevice(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').DeleteDeviceConfirmationDeleteEmailDeviceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery EmailDevicesTable {\n\t\temailDevices {\n\t\t\tid\n\t\t\tname\n\t\t\temail\n\t\t\tforbidden\n\t\t}\n\t}\n"): typeof import('./graphql').EmailDevicesTableDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment EmailerListItem on Emailer {\n\t\tid\n\t\tname\n\t\tisPrimary\n\t\tsmtpHost\n\t\tsmtpPort\n\t\tlastUsedAt\n\t\tmaxAttachmentSizeBytes\n\t\tsenderDisplayName\n\t\tsenderEmail\n\t\ttlsEnabled\n\t\tusername\n\t}\n"): typeof import('./graphql').EmailerListItemFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteEmailer($emailerId: Int!) {\n\t\tdeleteEmailer(id: $emailerId) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').DeleteEmailerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery EmailerSendHistory($id: Int!, $fetchUser: Boolean!) {\n\t\temailerById(id: $id) {\n\t\t\tsendHistory {\n\t\t\t\tsentAt\n\t\t\t\trecipientEmail\n\t\t\t\tsentByUserId\n\t\t\t\tsentBy @include(if: $fetchUser) {\n\t\t\t\t\tid\n\t\t\t\t\tusername\n\t\t\t\t}\n\t\t\t\tattachmentMeta {\n\t\t\t\t\tfilename\n\t\t\t\t\tmediaId\n\t\t\t\t\tmedia {\n\t\t\t\t\t\tresolvedName\n\t\t\t\t\t}\n\t\t\t\t\tsize\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').EmailerSendHistoryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery EmailersList {\n\t\temailers {\n\t\t\tid\n\t\t\t...EmailerListItem\n\t\t}\n\t}\n"): typeof import('./graphql').EmailersListDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation TestEmailer($config: EmailerClientConfig!, $recipient: String!) {\n\t\ttestEmailer(config: $config, recipient: $recipient)\n\t}\n"): typeof import('./graphql').TestEmailerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery ServerEmojisSection {\n\t\tcustomEmojis {\n\t\t\tid\n\t\t\tname\n\t\t\tisAnimated\n\t\t\turl\n\t\t}\n\t}\n"): typeof import('./graphql').ServerEmojisSectionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation ServerEmojisSectionUploadEmoji($input: CreateCustomEmojiInput!, $upload: Upload!) {\n\t\tuploadCustomEmoji(input: $input, upload: $upload) {\n\t\t\tid\n\t\t\tname\n\t\t\tisAnimated\n\t\t\turl\n\t\t}\n\t}\n"): typeof import('./graphql').ServerEmojisSectionUploadEmojiDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation ServerEmojisSectionRenameEmoji($id: ID!, $input: UpdateCustomEmojiInput!) {\n\t\tupdateCustomEmoji(id: $id, input: $input) {\n\t\t\tid\n\t\t\tname\n\t\t\tisAnimated\n\t\t\turl\n\t\t}\n\t}\n"): typeof import('./graphql').ServerEmojisSectionRenameEmojiDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation ServerEmojisSectionDeleteEmoji($id: ID!) {\n\t\tdeleteCustomEmoji(id: $id)\n\t}\n"): typeof import('./graphql').ServerEmojisSectionDeleteEmojiDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation ServerPublicURLUpdate($publicUrl: String!) {\n\t\tupdatePublicUrl(publicUrl: $publicUrl) {\n\t\t\tpublicUrl\n\t\t}\n\t}\n"): typeof import('./graphql').ServerPublicUrlUpdateDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery ServerPublicURL {\n\t\tserverConfig {\n\t\t\tpublicUrl\n\t\t}\n\t}\n"): typeof import('./graphql').ServerPublicUrlDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery ServerStats {\n\t\tnumberOfLibraries\n\t\tnumberOfSeries\n\t\tmediaCount\n\t\tmediaDiskUsage\n\t}\n"): typeof import('./graphql').ServerStatsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CreateScheduledJob($input: CreateScheduledJobInput!) {\n\t\tcreateScheduledJob(input: $input) {\n\t\t\t...ScheduledJobRow\n\t\t}\n\t}\n"): typeof import('./graphql').CreateScheduledJobDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UpdateScheduledJob($id: Int!, $input: UpdateScheduledJobInput!) {\n\t\tupdateScheduledJob(id: $id, input: $input) {\n\t\t\t...ScheduledJobRow\n\t\t}\n\t}\n"): typeof import('./graphql').UpdateScheduledJobDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteJobHistoryConfirmation {\n\t\tdeleteJobHistory {\n\t\t\taffectedRows\n\t\t}\n\t}\n"): typeof import('./graphql').DeleteJobHistoryConfirmationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation JobActionMenuCancelJob($id: ID!) {\n\t\tcancelJob(id: $id)\n\t}\n"): typeof import('./graphql').JobActionMenuCancelJobDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation JobActionMenuDeleteJob($id: ID!) {\n\t\tcancelJob(id: $id)\n\t}\n"): typeof import('./graphql').JobActionMenuDeleteJobDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation JobActionMenuDeleteLogs($id: ID!) {\n\t\tdeleteJobLogs(id: $id) {\n\t\t\taffectedRows\n\t\t}\n\t}\n"): typeof import('./graphql').JobActionMenuDeleteLogsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment JobDataInspector on CoreJobOutput {\n\t\t__typename\n\t\t... on LibraryScanOutput {\n\t\t\ttotalFiles\n\t\t\ttotalDirectories\n\t\t\tignoredFiles\n\t\t\tskippedFiles\n\t\t\tignoredDirectories\n\t\t\tcreatedMedia\n\t\t\tupdatedMedia\n\t\t\tcreatedSeries\n\t\t\tupdatedSeries\n\t\t}\n\t\t... on SeriesScanOutput {\n\t\t\ttotalFiles\n\t\t\tignoredFiles\n\t\t\tskippedFiles\n\t\t\tcreatedMedia\n\t\t\tupdatedMedia\n\t\t}\n\t\t... on ThumbnailGenerationOutput {\n\t\t\tvisitedFiles\n\t\t\tskippedFiles\n\t\t\tgeneratedThumbnails\n\t\t\tremovedThumbnails\n\t\t}\n\t}\n"): typeof import('./graphql').JobDataInspectorFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery ScheduledJobs {\n\t\tlibraries(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\temoji\n\t\t\t}\n\t\t}\n\t\tscheduledJobs {\n\t\t\tid\n\t\t\tname\n\t\t\t...ScheduledJobRow\n\t\t}\n\t}\n"): typeof import('./graphql').ScheduledJobsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteScheduledJob($id: Int!) {\n\t\tdeleteScheduledJob(id: $id)\n\t}\n"): typeof import('./graphql').DeleteScheduledJobDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery JobTable($pagination: Pagination!) {\n\t\tjobs(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tname\n\t\t\t\tdescription\n\t\t\t\tstatus\n\t\t\t\tcreatedAt\n\t\t\t\tcompletedAt\n\t\t\t\tmsElapsed\n\t\t\t\toutputData {\n\t\t\t\t\t...JobDataInspector\n\t\t\t\t}\n\t\t\t\tlogCount\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').JobTableDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment ScheduledJobRow on ScheduledJob {\n\t\tid\n\t\tname\n\t\tkind\n\t\tschedule\n\t\tconfig\n\t\tenabled\n\t\tcreatedAt\n\t\tlastRunAt\n\t}\n"): typeof import('./graphql').ScheduledJobRowFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tsubscription LiveLogsFeed {\n\t\ttailLogFile\n\t}\n"): typeof import('./graphql').LiveLogsFeedDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteLogs {\n\t\tdeleteLogs {\n\t\t\tdeleted\n\t\t}\n\t}\n"): typeof import('./graphql').DeleteLogsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery PersistedLogs(\n\t\t$filter: LogFilterInput!\n\t\t$pagination: Pagination!\n\t\t$orderBy: [LogModelOrderBy!]!\n\t) {\n\t\tlogs(filter: $filter, pagination: $pagination, orderBy: $orderBy) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\ttimestamp\n\t\t\t\tlevel\n\t\t\t\tmessage\n\t\t\t\tjobId\n\t\t\t\tcontext\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\ttotalPages\n\t\t\t\t\tcurrentPage\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').PersistedLogsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CreateProviderDialogCreateProvider($input: CreateMetadataProviderConfigInput!) {\n\t\tcreateMetadataProvider(input: $input) {\n\t\t\tid\n\t\t\tproviderType\n\t\t\tenabled\n\t\t}\n\t}\n"): typeof import('./graphql').CreateProviderDialogCreateProviderDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation EditProviderDialog($id: Int!, $input: PatchMetadataProviderConfigInput!) {\n\t\tupdateMetadataProvider(id: $id, input: $input) {\n\t\t\tid\n\t\t\t...ExistingProviderCard\n\t\t}\n\t}\n"): typeof import('./graphql').EditProviderDialogDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteProviderDialog($id: Int!) {\n\t\tdeleteMetadataProvider(id: $id) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').DeleteProviderDialogDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment ExistingProviderCard on MetadataProviderConfigModel {\n\t\tid\n\t\tproviderType\n\t\tenabled\n\t\tapiTokenExpiresAt\n\t\tautoApplyConfig\n\t\tcreatedAt\n\t\tupdatedAt\n\t}\n"): typeof import('./graphql').ExistingProviderCardFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery ProvidersSectionGetProviders {\n\t\tmetadataProviderConfigs {\n\t\t\tid\n\t\t\tproviderType\n\t\t\tposition\n\t\t\t...ExistingProviderCard\n\t\t}\n\t}\n"): typeof import('./graphql').ProvidersSectionGetProvidersDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation ProvidersSectionSetPreferred($id: Int!, $input: PatchMetadataProviderConfigInput!) {\n\t\tupdateMetadataProvider(id: $id, input: $input) {\n\t\t\tid\n\t\t\tposition\n\t\t}\n\t}\n"): typeof import('./graphql').ProvidersSectionSetPreferredDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CreateTagModal($tags: [String!]!) {\n\t\tcreateTags(tags: $tags) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').CreateTagModalDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteTagConfirmModal($tags: [String!]!) {\n\t\tdeleteTags(tags: $tags) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').DeleteTagConfirmModalDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation RenameTagModal($id: Int!, $name: String!) {\n\t\trenameTag(id: $id, name: $name) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').RenameTagModalDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery TagTable {\n\t\ttags {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').TagTableDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery UserStats {\n\t\tuserCount\n\t\ttopReaders(take: 1) {\n\t\t\tid\n\t\t\tusername\n\t\t\tfinishedReadingSessionsCount\n\t\t}\n\t\tactiveReadingSessionCount\n\t\tfinishedReadingSessionCount\n\t}\n"): typeof import('./graphql').UserStatsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CreateOrUpdateUserFormUpdateUser($id: ID!, $input: UpdateUserInput!) {\n\t\tupdateUser(id: $id, input: $input) {\n\t\t\tid\n\t\t\tusername\n\t\t\tageRestriction {\n\t\t\t\tage\n\t\t\t\trestrictOnUnset\n\t\t\t}\n\t\t\tpermissions\n\t\t\tmaxSessionsAllowed\n\t\t}\n\t}\n"): typeof import('./graphql').CreateOrUpdateUserFormUpdateUserDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CreateOrUpdateUserFormCreateUser($input: CreateUserInput!) {\n\t\tcreateUser(input: $input) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').CreateOrUpdateUserFormCreateUserDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery CreateUserScene {\n\t\tusers(pagination: { none: { unpaginated: true } }) {\n\t\t\tnodes {\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').CreateUserSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery UpdateUserScene($id: ID!, $skip: Boolean!) {\n\t\tme {\n\t\t\tid\n\t\t}\n\t\tuserById(id: $id) @skip(if: $skip) {\n\t\t\tid\n\t\t\tavatarUrl\n\t\t\tusername\n\t\t\tageRestriction {\n\t\t\t\tage\n\t\t\t\trestrictOnUnset\n\t\t\t}\n\t\t\tpermissions\n\t\t\tmaxSessionsAllowed\n\t\t\tisServerOwner\n\t\t}\n\t\tusers(pagination: { none: { unpaginated: true } }) @skip(if: $skip) {\n\t\t\tnodes {\n\t\t\t\tusername\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').UpdateUserSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation ClearLoginActivityConfirmation {\n\t\tdeleteLoginActivity\n\t}\n"): typeof import('./graphql').ClearLoginActivityConfirmationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery LoginActivityTable {\n\t\tloginActivity {\n\t\t\tid\n\t\t\tipAddress\n\t\t\tuserAgent\n\t\t\tauthenticationSuccessful\n\t\t\ttimestamp\n\t\t\tuser {\n\t\t\t\tid\n\t\t\t\tusername\n\t\t\t\tavatarUrl\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').LoginActivityTableDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteUser($id: ID!, $hardDelete: Boolean) {\n\t\tdeleteUser(id: $id, hardDelete: $hardDelete) {\n\t\t\tid\n\t\t}\n\t}\n"): typeof import('./graphql').DeleteUserDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UserActionMenuLockUser($id: ID!, $lock: Boolean!) {\n\t\tupdateUserLockStatus(id: $id, lock: $lock) {\n\t\t\tid\n\t\t\tisLocked\n\t\t}\n\t}\n"): typeof import('./graphql').UserActionMenuLockUserDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UserActionMenuDeleteUserSessions($id: ID!) {\n\t\tdeleteUserSessions(id: $id)\n\t}\n"): typeof import('./graphql').UserActionMenuDeleteUserSessionsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery UserTable($pagination: Pagination!) {\n\t\tusers(pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tid\n\t\t\t\tavatarUrl\n\t\t\t\tusername\n\t\t\t\tisServerOwner\n\t\t\t\tisLocked\n\t\t\t\tcreatedAt\n\t\t\t\tlastLogin\n\t\t\t\tloginSessionsCount\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\ttotalPages\n\t\t\t\t\tcurrentPage\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').UserTableDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment SmartListCard on SmartList {\n\t\tid\n\t\tdescription\n\t\tfilters\n\t\tjoiner\n\t\tname\n\t}\n"): typeof import('./graphql').SmartListCardFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SmartListsWithSearch($input: SmartListsInput!) {\n\t\tsmartLists(input: $input) {\n\t\t\tid\n\t\t\tcreatorId\n\t\t\tdescription\n\t\t\tdefaultGrouping\n\t\t\tfilters\n\t\t\tjoiner\n\t\t\tname\n\t\t\tvisibility\n\t\t\t...SmartListCard\n\t\t}\n\t}\n"): typeof import('./graphql').SmartListsWithSearchDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SmartListById($id: ID!) {\n\t\tsmartListById(id: $id) {\n\t\t\tid\n\t\t\tcreatorId\n\t\t\tdescription\n\t\t\tdefaultGrouping\n\t\t\tfilters\n\t\t\tjoiner\n\t\t\tname\n\t\t\tvisibility\n\t\t\tviews {\n\t\t\t\tid\n\t\t\t\tlistId\n\t\t\t\tname\n\t\t\t\tbookColumns {\n\t\t\t\t\tid\n\t\t\t\t\tposition\n\t\t\t\t}\n\t\t\t\tbookSorting {\n\t\t\t\t\tid\n\t\t\t\t\tdesc\n\t\t\t\t}\n\t\t\t\tgroupColumns {\n\t\t\t\t\tid\n\t\t\t\t\tposition\n\t\t\t\t}\n\t\t\t\tgroupSorting {\n\t\t\t\t\tid\n\t\t\t\t\tdesc\n\t\t\t\t}\n\t\t\t\tsearch\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').SmartListByIdDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SmartListMeta($id: ID!) {\n\t\tsmartListMeta(id: $id) {\n\t\t\tmatchedBooks\n\t\t\tmatchedSeries\n\t\t\tmatchedLibraries\n\t\t}\n\t}\n"): typeof import('./graphql').SmartListMetaDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UpdateSmartList($id: ID!, $input: SaveSmartListInput!) {\n\t\tupdateSmartList(id: $id, input: $input) {\n\t\t\t__typename\n\t\t}\n\t}\n"): typeof import('./graphql').UpdateSmartListDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SmartListItems($id: ID!) {\n\t\tsmartListItems(id: $id) {\n\t\t\t__typename\n\t\t\t... on SmartListGrouped {\n\t\t\t\titems {\n\t\t\t\t\tentity {\n\t\t\t\t\t\t__typename\n\t\t\t\t\t\t... on Series {\n\t\t\t\t\t\t\tid\n\t\t\t\t\t\t\tname\n\t\t\t\t\t\t}\n\t\t\t\t\t\t... on Library {\n\t\t\t\t\t\t\tid\n\t\t\t\t\t\t\tname\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t\tbooks {\n\t\t\t\t\t\t...BookCard\n\t\t\t\t\t\t...BookMetadata\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\t... on SmartListUngrouped {\n\t\t\t\tbooks {\n\t\t\t\t\t...BookCard\n\t\t\t\t\t...SmartListItemBookMetadata\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').SmartListItemsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tfragment SmartListItemBookMetadata on Media {\n\t\tmetadata {\n\t\t\tageRating\n\t\t\tcharacters\n\t\t\tcolorists\n\t\t\tcoverArtists\n\t\t\teditors\n\t\t\tgenres\n\t\t\tinkers\n\t\t\tletterers\n\t\t\tlinks\n\t\t\tpencillers\n\t\t\tpublisher\n\t\t\tteams\n\t\t\twriters\n\t\t\tyear\n\t\t\tmonth\n\t\t\tday\n\t\t\tformat\n\t\t\tidentifierAmazon\n\t\t\tidentifierCalibre\n\t\t\tidentifierGoogle\n\t\t\tidentifierIsbn\n\t\t\tidentifierMobiAsin\n\t\t\tidentifierUuid\n\t\t\tlanguage\n\t\t\tnotes\n\t\t\tnumber\n\t\t\tpageCount\n\t\t\tseries\n\t\t\tseriesGroup\n\t\t\tstoryArc\n\t\t\tstoryArcNumber\n\t\t\ttitle\n\t\t\ttitleSort\n\t\t\tvolume\n\t\t}\n\t}\n"): typeof import('./graphql').SmartListItemBookMetadataFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation CreateSmartListView($input: SaveSmartListView!) {\n\t\tcreateSmartListView(input: $input) {\n\t\t\tid\n\t\t\tlistId\n\t\t\tname\n\t\t\tsearch\n\t\t\tenableMultiSort\n\t\t\tbookColumns {\n\t\t\t\tid\n\t\t\t\tposition\n\t\t\t}\n\t\t\tbookSorting {\n\t\t\t\tid\n\t\t\t\tdesc\n\t\t\t}\n\t\t\tgroupColumns {\n\t\t\t\tid\n\t\t\t\tposition\n\t\t\t}\n\t\t\tgroupSorting {\n\t\t\t\tid\n\t\t\t\tdesc\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').CreateSmartListViewDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation UpdateSmartListView($originalName: String!, $input: SaveSmartListView!) {\n\t\tupdateSmartListView(originalName: $originalName, input: $input) {\n\t\t\tid\n\t\t\tlistId\n\t\t\tname\n\t\t\tsearch\n\t\t\tenableMultiSort\n\t\t\tbookColumns {\n\t\t\t\tid\n\t\t\t\tposition\n\t\t\t}\n\t\t\tbookSorting {\n\t\t\t\tid\n\t\t\t\tdesc\n\t\t\t}\n\t\t\tgroupColumns {\n\t\t\t\tid\n\t\t\t\tposition\n\t\t\t}\n\t\t\tgroupSorting {\n\t\t\t\tid\n\t\t\t\tdesc\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').UpdateSmartListViewDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteSmartListView($id: ID!, $name: String!) {\n\t\tdeleteSmartListView(id: $id, name: $name) {\n\t\t\tid\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').DeleteSmartListViewDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery SmartListBasicSettingsScene {\n\t\tsmartLists(input: { mine: true }) {\n\t\t\tname\n\t\t}\n\t}\n"): typeof import('./graphql').SmartListBasicSettingsSceneDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tmutation DeleteSmartList($id: ID!) {\n\t\tdeleteSmartList(id: $id) {\n\t\t\t__typename\n\t\t}\n\t}\n"): typeof import('./graphql').DeleteSmartListDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery DirectoryListing($input: DirectoryListingInput!, $pagination: Pagination!) {\n\t\tlistDirectory(input: $input, pagination: $pagination) {\n\t\t\tnodes {\n\t\t\t\tparent\n\t\t\t\tfiles {\n\t\t\t\t\tname\n\t\t\t\t\tpath\n\t\t\t\t\tisDirectory\n\t\t\t\t\tmedia {\n\t\t\t\t\t\tid\n\t\t\t\t\t\tresolvedName\n\t\t\t\t\t\tthumbnail {\n\t\t\t\t\t\t\turl\n\t\t\t\t\t\t}\n\t\t\t\t\t\textension\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\tpageInfo {\n\t\t\t\t__typename\n\t\t\t\t... on OffsetPaginationInfo {\n\t\t\t\t\tcurrentPage\n\t\t\t\t\ttotalPages\n\t\t\t\t\tpageSize\n\t\t\t\t\tpageOffset\n\t\t\t\t\tzeroBased\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n"): typeof import('./graphql').DirectoryListingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n\tquery UploadConfig {\n\t\tuploadConfig {\n\t\t\tenabled\n\t\t\tmaxFileUploadSize\n\t\t}\n\t}\n"): typeof import('./graphql').UploadConfigDocument;


export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}
