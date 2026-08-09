// async-graphql expands the merged Query/Mutation trees into deeply nested resolver
// futures. The test profile monomorphizes further than a plain build, and the default
// limit of 128 is not enough for a schema this size -- the mutation modules are already
// chunked into MergedObject groups partly for the same reason.
#![recursion_limit = "256"]
#![warn(clippy::dbg_macro)]

pub mod config;
pub mod errors;
pub mod http_server;
pub mod middleware;
pub mod routers;
pub mod utils;

pub use http_server::{bootstrap_http_server_config, run_http_server};
