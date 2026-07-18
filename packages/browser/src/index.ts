import 'overlayscrollbars/overlayscrollbars.css'

import LongboxWebClient from './App'
import { AppRouter } from './AppRouter'

// https://stackoverflow.com/questions/72114775/vite-global-is-not-defined
window.global ||= window

export const DEBUG_ENV = import.meta.env.DEV
export const API_VERSION = import.meta.env.API_VERSION ?? 'v2'

export { AppRouter as LongboxRouter, LongboxWebClient }

export { Link, useNavigate } from './context'
export { usePaths } from './paths'
