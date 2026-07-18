import type { Config } from 'jest'

export default {
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
	},
	modulePathIgnorePatterns: ['<rootDir>/dist/'],
	testEnvironment: 'jsdom',
	transform: {
		'^.+\\.tsx?$': 'babel-jest',
	},
} satisfies Config
