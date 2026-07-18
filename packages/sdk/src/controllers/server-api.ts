import { APIBase } from '../base'
import { LongboxVersion } from '../types'
import { ClaimResponse } from '../types/rest'
import { APIResult, ClassQueryKeys } from './types'
import { createRouteURLHandler } from './utils'

/**
 * The root route for the server API
 */
const SERVER_ROUTE = ''
/**
 * A helper function to format the URL for server API routes with optional query parameters
 */
const serverURL = createRouteURLHandler(SERVER_ROUTE)

/**
 * The server API controller, used for interacting with the server endpoints of the Longbox API
 */
export class ServerAPI extends APIBase {
	/**
	 * Get the version of the Longbox instance
	 */
	async version(): Promise<LongboxVersion> {
		const { data: version } = await this.axios.post<LongboxVersion>(serverURL('/version'))
		return version
	}

	/**
	 * Ping the Longbox service to check if it is available
	 */
	async ping(): Promise<APIResult<string>> {
		return this.axios.get('/ping')
	}

	/**
	 * Check if the Longbox instance has been claimed (at least one user who is the owner)
	 */
	async claimedStatus(): Promise<APIResult<ClaimResponse>> {
		const { data, ...response } = await this.axios.get('/claim')
		if (typeof data !== 'object' && !('isClaimed' in data)) {
			throw new Error('Malformed response received from server')
		}
		return { data, ...response }
	}

	get keys(): ClassQueryKeys<InstanceType<typeof ServerAPI>> {
		return {
			claimedStatus: 'server.claimedStatus',
			ping: 'server.ping',
			version: 'server.version',
		}
	}
}
